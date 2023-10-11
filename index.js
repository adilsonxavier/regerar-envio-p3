#!/usr/bin/env node
import axios from 'axios';
import fs from 'fs';
import json2csvConverter from 'json-2-csv';
import _ from 'lodash';
import neatCsv from 'neat-csv';
import path from 'path';
import pdfToBase64 from 'pdf-to-base64';
import logger from 'simple-node-logger';

import { contractsConfig } from './config.js';

async function main() {
    let _logger = null;
    let _proposalsData = [];
    let dataToReport = [] ; // Adilson
    const _csvDocName = '26001-27000';
    const _documentsName = {
        CARTAO: ['BGNTCCC', 'BGNCCBADCARTV6'],
        PORTABILIDADE: [
            'BGNTRPV2',
            'BGNCCBUNIFV15',
            'BGNCCBUNIFV13',
            'BGNCCBCSGPCONV3',
            'BGNCCBCSGPCON',
            'BGNCCBUNIFV13',
        ],
        NOVO: [
            'BGNCCBUNIFV15',
            'BGNCCBUNIFV13',
            'BGNCCBCSGPCONV3',
            'BGNCCBCSGPCON',
            'BGNCCBUNIFV13',
        ],
        REFINANCIAMENTO: [
            'BGNCCBUNIFV15',
            'BGNCCBUNIFV14',
            'BGNCCBUNIFV13',
            'BGNCCBCSGPCONV3',
            'BGNCCBCSGPCON',
            'BGNCCBUNIFV13',
        ],
        PRIVADO: [
            'BGNCCBCSGPCONV3',
            'BGNCCBCSGPCON',
            'BGNCCBCSGPCON',
            'BGNCCBUNIFV13',
            'BGNCCBUNIFV15',
        ],
    };

    async function init() {
        _logger = createLogger();

        _proposalsData = await parseCsvToArray(`./data/${_csvDocName}.csv`);
        // _proposalsData = _fillContract(_proposalsData);
        _proposalsData = _fillProduct(_proposalsData);

        const proposalDataChunk = _.chunk(
            _proposalsData,
            _proposalsData.length / 2
        );

        await Promise.all(
            proposalDataChunk.map((proposalArray) =>
                generateDocuments(proposalArray)
            )
        );
    }
    /////////// Adilson ///////////
    async function _getProposalById(proposal) {
        const response = await axios.post(
            'https://motor.cetelem.com.br/api/Script/Run',
            {
                ScriptName: 'consulta-cetelem\\public\\proposal\\get-proposal-on-identify-by-id',
                ScriptParameters: {
                    proposal,
                },
                Token: '59f9083e-6077-4bf6-a5a3-9cd2fbbdbc94',
            }
        );

        if (!response || response.error) {
            throw new Error(
                `Resposta do método _getProposalById inválido: [${JSON.stringify(
                    response
                )}]`
            );
        }

        return response.data;
    }
    /////////// Adilson fim///////////
    async function generateDocuments(proposalDataArray) {
        let index = 1;
       // let dataToReport = [];// Adilson

        for (const {
            proposalId,
            contract,
            product
        } of proposalDataArray) {
            _logger.info(
                `Processando proposta ${proposalId} (Processo ${index} de ${proposalDataArray.length})`
            );

            try {
                let proposalData = await _getProposalById(proposalId);

                if (proposalData.length === 0) {
                    _logger.info(`Proposta ${proposalId} não encontrada`);
                } else {
                    proposalData = _.head(proposalData.filter(item => item.status === 'APPROVED' || (item.status === 'DERIVED' && item.statusMesa === 'APROVADO')))                    

                    const documents = await _getDocumentsBySubscription(
                        proposalId,
                        product
                    );

                    const docPDF = _buildDocPDFdata(
                        proposalId,
                        proposalData.clientId,
                        documents
                    );

                    proposalData.contract = contract;
                    proposalData.product = product;
                    proposalData.signedDocumentsUrl = await _getSignedDocumentsUrlRequest(
                        proposalData.sessionId,
                        proposalData.clientId,
                        docPDF
                    );

                    // const signedDocumentsUrl =
                    //     await _getSignedDocumentsUrlRequestMotorNovo(uuid);

                    await _transformDocumentAndSendToP3(proposalData);

                    dataToReport.push(proposalData);
                }


            } catch (error) {
                _logger.error(`generateDocuments :: ${error}`);
                _logger.error(`generateDocuments :: ${JSON.stringify(error)}`);
            }

            index++;
        }

        await _buildReport(dataToReport);
    }

    function createLogger() {
        return logger.createSimpleLogger({
            logFilePath: `./logs/${_csvDocName}.log`,
            timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
        });
    }

    async function parseCsvToArray(csvPath) {
        return new Promise((resolve) => {
            fs.readFile(csvPath, async (error, data) => {
                if (error) {
                    console.error(error);
                    return;
                }

                const arrayData = await neatCsv(data, {
                    separator: ';'
                });

                resolve(arrayData);
            });
        });
    }

    async function _getDocumentsBySubscription(proposalId, product) {
        _logger.info(`Executando _getDocumentsBySubscription com dados :: proposalId: ${proposalId} e product: ${product}`)
        const documents = [];
        const documentsName = _documentsName[product];

        for (const documentName of documentsName) {
            try {
                const document = await _getDocumentBySubscriptionRequest(
                    proposalId,
                    documentName
                );

                if (document) {
                    documents.push({
                        documentName,
                        base64: document,
                    });
                }

                _logger.info(
                    `_getDocumentBySubscription :: Recuperando contrato para proposta ${proposalId} e documento ${documentName}`
                );
            } catch (error) {
                _logger.error(
                    `_getDocumentBySubscription :: Contrato não encontrado para proposta ${proposalId} e documento ${documentName}`
                );
                _logger.error(
                    `Erro na API:: ${error.message}`
                );
            }
        }

        return documents;
    }

    async function _getDocumentBySubscriptionRequest(
        subscriptionId,
        documentName
    ) {
        const response = await axios.get(
            `https://api.cetelem.com.br/payroll-loans/v1/subscriptions/${subscriptionId}/${documentName}/document`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    useridentification: 'STONEAGE|Ct#242668',
                    callerReference: 'API',
                    requestId: '02443ef1-d4d3-40da-ab17-1b269271cdca',
                    conversationId: '10101010101',
                    Authorization:
                        'Bearer eyJhbGciOiJIUzI1NiJ9.ew0KCSJwYXJ0bmVyX2lkIjogIjE4MTI0NzAwMDAwMTUzIiwNCiAgCSJkYXRhIjogImV5SmxibU1pT2lKQk1qVTJSME5OSWl3aVlXeG5Jam9pVWxOQkxVOUJSVkF0TWpVMkluMC5UbFlRbm1aTnN0YVBJLWtSSmRtc2hPSVFyRHh0ZlFjMk1YR1dwLThScVE5WlZrbjR2bEFKN3JUdlJweDl0YVk5X3FCTFl0dVM2NkNkaFZOVFV3V1NoVTNacGNjZ1FhemtIQjQtSEJNOUhoS3VBYmFsc0VGZmtKaGtCTFlhVGZvR2lPMVEtTXZzc0xWcXhCUWpJcVppcW5oU2ZiUnVRbDdaOVFNcTFOZ0dOdnI5VHNtOUFwNXdHbGY2SzFYZ0gyLWpBaVduUEpDUVBIZktrUU1iMk51NEZUOGhucmtpbElCcFVxQ2lCWHF5blpKRWVzUTV4dm1nMUZsbkxldVBPNzBhRi1PZno2UzZucURRRW9sbGZZWVE2ZkZPN3pUak5hQ294ZWh2RzBnS09qRFFVQkE5bmllcFJFTEt0V05RNUYxenFSTVV5T2pYWERfWGc3bENjTUhkaVEuQm1WbWtieEttYndYcF9rWS5xX2RuTUdSOV9xeXhGS3d4dWVwME1wZ3RqNE90UW4zT3ZjNXVsNDVrdHV5LUp5MVpSMzBJNld3SE12NURZV1pmekRMOGJ4UjRHSDQzYUVZRENDV0xlRFRyancxdWhWMU9WanAwNzlua2todXg3bUNydWwzazVwNUhxTjNuTjhNOFAyTDBBNmRnUi1mNklCTjRGY1dpdndDTTF2TXFMXzBSMjRoQl9ZQWRoemJfeGNWNExjNVhjNWF5ampYX2oyY2VGYnJNQ3pZdXR5bXVadE1fUnVHSGZmMExuMTJLMjJUeHlCd3FTcl9tU3FXb2VJTnJCaVhoVGtqRmtnTlRkX3d4YWVFZV9IUzM0M1RUR0lEaGV3amhncTdyWTNWcHhFZ1V3Rmd2S2k1eUNaQVA4b2hkNnZ1TjJyWUx2Y0hjSnFXdFV5Sm8zY1NvbkQ5XzRXRG54ZnN5S0V6VWlKeTdzdzlLaXh5am53dXY2aUl4TkJ6dV9ONG01RVY4NDVvOEhaTmNLR2NWSnlXUWlQUnBxblpzd3VqRUhJMDJmQzhGYTBEbkFQaktaN0M5U0tLdkUtY09PV1RtWHdKMXlUWDd4QWg4LUpEM0dFZVVscUkzSjdfX0tfSzFNelJsZ1N3TVdvajhHTDBMSTVrdjJzREVuV25nRVFtTjhKRWU5UHdWODF4TUhERlh0Szg0em5vUW9qc3dLTTZBNVFtV3F3NkgtaTk1V2YyNy1SOE1MNks3bnNjQ0FObHNyRGZMa1JCQUloaHpVYi0xRGNwWmN5Y0trOEpUMnhWbFllaXR3QWZkOEpOT05Hc2M0Y29QZDFyTzBaYzlqUjc5c2dKcVNuMFhkMFJ4cEhfZDYzOHVoYVZFYXhzSEZHVlRXcXZmTzZ4aGRfSmRkcVlEcDVDbXlZOXdmdFFIdGdYY1REU0ZUVlN3VEJGNGFTU2swbkR2OVJHaGdkbEhGZy5Obl9CUW1hQlFMSVVZOHlBWHVMdER3Ig0KfQ0KDQoNCg0K.dV76oPgkDnNKHP0Su8s8aSWOfMGmDpT2vO8z_nGEQb4',
                },
            }
        );

        if (!response || response.error) {
            throw new Error(
                `Resposta do método _getDocumentBySubscriptionRequest inválido: [${JSON.stringify(
                    response
                )}]`
            );
        }

        const document = _.get(
            response,
            'data.Body.generateDocumentBySubscriptionResponse.generateDocumentBySubscription.document',
            null
        );

        return document;
    }

    async function _getSignedDocumentsUrlRequestMotorNovo(uuid) {
        const response = await axios.post(
            'https://motor.cetelem.com.br/api/Script/Run',
            {
                ScriptName: 'processos-paralelos\\regerar-banco-novo',
                ScriptParameters: { uuid },
                Token: '59f9083e-6077-4bf6-a5a3-9cd2fbbdbc94',
            }
        );

        if (!response || response.error) {
            throw new Error(
                `Resposta do método _getSignedDocumentsUrlRequestMotorNovo inválido: [${JSON.stringify(
                    response
                )}]`
            );
        }

        const signedDocumentsUrl = response.data.proposals.reduce(
            (acc, { contracts }) =>
                contracts.reduce(
                    (acc, { signed }) => [...acc, signed.link],
                    ''
                ),
            []
        );

        return signedDocumentsUrl;
    }

    async function _getSignedDocumentsUrlRequest(sessionId, clientId, docPDF) {
        const response = await axios.post(
            'https://motor.cetelem.com.br/api/Script/Run',
            {
                ScriptName: 'processos-paralelos\\callback-pdf64',
                ScriptParameters: {
                    sessionId,
                    clientId,
                    docPDF,
                },
                Token: '59f9083e-6077-4bf6-a5a3-9cd2fbbdbc94',
            }
        );

        if (!response || response.error) {
            throw new Error(
                `Resposta do método _getSignedDocumentsUrlRequest inválido: [${JSON.stringify(
                    response
                )}]`
            );
        }

        _logger.info(JSON.stringify(response.data.docPDF))

        const signedDocumentsUrl = response.data.docPDF.reduce(
            (acc, { documents }) =>
                documents.reduce((acc, doc) => [...acc, doc['pdf-link']], ''),
            []
        );

        return signedDocumentsUrl;
    }

    async function _sendToP3Request(fileName, base64, contract) {
        const response = await axios.post(
            'https://www.p3store.com.br/api/registros/arquivos',
            {
                GrupoDivisao: 1,
                TipoDivisao: 2,
                TipoDocumento: 5,
                NomeArquivo: fileName,
                CorpoBase64: base64,
                Contrato: contract,
                EnvioDigital: true,
            },
            {
                headers: {
                    'Content-type': 'application/json',
                    Token: 'ay2VDafx2g3EhTKx+FRs67XBeU30Oo3yAGjXq4zyvgi+HW+PgK0251rCxOl4WVmKDYGY9n4qIELaFORrIAR17A40b1Bz+4AC3SkjHdNnH04SPujXOWskqFzk2NgTitxQAQNayK759B8dHofekwb4WJEC4daPcQs7QRmGXx4833s=',
                },
            }
        );

        if (!response || response.error) {
            throw new Error(
                `Resposta do método _sendToP3Request inválido: [${JSON.stringify(
                    response
                )}]`
            );
        }

        return response;
    }

    async function _transformDocumentAndSendToP3({ signedDocumentsUrl, contract }) {
        for (const documentUrl of signedDocumentsUrl) {
            const fileName = path.basename(documentUrl);
            const base64 = await pdfToBase64(documentUrl);

            await _sendToP3Request(fileName, base64, contract);

            _logger.info(
                `_transformDocumentAndSendToP3 :: Contrato ${fileName} enviado para P3`
            );
        }
    }

    function _buildDocPDFdata(proposalId, clientId, documents = []) {
        return [
            {
                proposal: proposalId,
                documents: documents.map(({ base64, documentName }) => ({
                    base64,
                    documentKey: `${clientId}-${proposalId}-${documentName}`,
                })),
            },
        ];
    }

    async function _buildReport(data) {
        const csvFile = await json2csvConverter.json2csv(data, {
            delimiter: {
                field: ';'
            }
        })

        fs.writeFileSync(`./reports/${_csvDocName}.csv`, csvFile);
    }

    function _fillContract(proposalData) {
        return proposalData.map((data) => ({
            ...data,
            contract: data.contract.replace(/[^\w\s]/gi, ''),
        }));
    }

    function _fillProduct(proposalData) {
        return proposalData.map((data) => {
            const contractPrefix = data.contract.substr(0, 2);

            const { contractType } = contractsConfig.find(({ operationType }) =>
                operationType.find((value) => contractPrefix === value)
            );

            return {
                ...data,
                product: contractType,
            };
        });
    }

    await init();
}

main();
