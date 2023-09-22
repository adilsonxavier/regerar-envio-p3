#!/usr/bin/env node
import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import neatCsv from 'neat-csv';
import pdfToBase64 from 'pdf-to-base64';
import logger from 'simple-node-logger';

import { contractsConfig } from './config.js';

async function main() {
    let _logger = null;
    let _proposalsData = [];

    const _csvDocName = '0-100';
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
                    separator: ';',
                });

                resolve(arrayData);
            });
        });
    }

    async function generateDocuments(proposalDataArray) {
        let index = 1;

        for (const {
            proposalId,
            product,
            contract,
            // uuid,
        } of proposalDataArray) {
            _logger.info(
                `Processando proposta ${proposalId} (Processo ${index} de ${proposalDataArray.length})`
            );

            try {


                // todo: criar uma função que execute essa chamada
                // -> se basear no método abaixo: _getSignedDocumentsUrlRequest()            
                // {
                //     "Token": "{{ _.motor.token }}",
                //     "ScriptName": "consulta-cetelem\\public\\proposal\\get-proposal-on-identify-by-id",
                //     "ScriptParameters": {
                //         "proposal": "842785851" -> variável = proposalId
                //     }
                // }
                // 
                // retorno: Sempre filtrar os status: APPROVED ou DERIVED e statusMesa: APROVADO
                // Se houver os dois: filtrar pelo mais novo
                // {
                // 	"result": [
                // 		{
                // 			"cpf": "28353692449",
                // 			"propostaId": "842866177",
                // 			"sessionId": "8dc32be0-4eec-46c4-8566-9e902fb8c71e",
                // 			"clientId": "14641011",
                // 			"createdAt": "2020-06-05T08:04:43Z",
                // 			"status": "EXPIRED",
                // 			"statusMesa": null
                // 		},
                // 		{
                // 			"cpf": "28353692449",
                // 			"propostaId": "842866177",
                // 			"sessionId": "e5c7379e-bb70-48ce-8df8-d092fb6fbe8e",
                // 			"clientId": "14641011",
                // 			"createdAt": "2020-06-10T18:50:22Z",
                // 			"status": "DERIVED",
                // 			"statusMesa": "APROVADO"
                // 		},
                //      {
                // 			"cpf": "28353692449",
                // 			"propostaId": "842866177",
                // 			"sessionId": "e5c7379e-bb70-48ce-8df8-d092fb6fbe8e",
                // 			"clientId": "14641011",
                // 			"createdAt": "2020-06-10T18:50:22Z",
                // 			"status": "DERIVED",
                // 			"statusMesa": "REPROVADO"
                // 		},
                //      {
                // 			"cpf": "28353692449",
                // 			"propostaId": "842866177",
                // 			"sessionId": "e5c7379e-bb70-48ce-8df8-d092fb6fbe8e",
                // 			"clientId": "14641011",
                // 			"createdAt": "2020-06-10T18:50:22Z",
                // 			"status": "APPROVED",
                // 			"statusMesa": "null"
                // 		}
                // 	]
                // }


                const documents = await _getDocumentsBySubscription(
                    proposalId,
                    product
                );

                const docPDF = _buildDocPDFdata(
                    proposalId,
                    clientId,
                    documents
                );

                const signedDocumentsUrl = await _getSignedDocumentsUrlRequest(
                    sessionId,
                    clientId,
                    docPDF
                );

                // const signedDocumentsUrl =
                //     await _getSignedDocumentsUrlRequestMotorNovo(uuid);

                // todo: descomentar quando tiver ok
                // await _transformDocumentAndSendToP3(
                //     signedDocumentsUrl,
                //     contract
                // );
            } catch (error) {
                _logger.error(`generateDocuments :: ${error}`);
                _logger.error(`generateDocuments :: ${JSON.stringify(error)}`);
            }

            index++;
        }
    }

    async function _getDocumentsBySubscription(proposalId, product) {
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
                    useridentification: 'STONETEMP',
                    callerReference: 'API',
                    requestId: '02443ef1-d4d3-40da-ab17-1b269271cdca',
                    conversationId: '10101010101',
                    Authorization:
                        'Bearer eyJhbGciOiJIUzI1NiJ9.ew0KCSJwYXJ0bmVyX2lkIjogIjE4MTI0NzAwMDAwMTUzIiwNCiAgCSJkYXRhIjogImV5SmxibU1pT2lKQk1qVTJSME5OSWl3aVlXeG5Jam9pVWxOQkxVOUJSVkF0TWpVMkluMC5kVmVxWHYxekZPeE5tODU5djlLbi1IekY4TS0tWnA3dG1xaTQwRkF3enBOTVVpbHBSN2doSFJkNElsVG45d2R3cUFhbzA1eGZBWG11aDJiM2dIWGxrRGhUb28wY1l0TVhabUZhZllWVkJQZU5BM0ZEOGJ0VmRmV1FpOHVlQUlOcTN0RDJhbml3UzItVV94T0ZUaXFLV3hUWEFCUVluZjU1N2o1YjBKN0RiS2g4RVl2c29rVDZsT1l3REU0Ym1PM2pUUElwM2pscW8xdUFvdmhNXy1jUTZjcnQ0NEh6VUl5WUlpUDJnWkJRMnpsSmx3OHEta21Na25hS3ctekQwcW9ldjE0WGw4ZlRDMTJDX3dtaUJTV01ZMkdwOWxMYUR3bExXbURSSVpDWl9PekN1cFRrN1RrYUlWTDhucFREbmM2UElPQ1FTNWR3SUVDamZsM3VBa3p1eGcuc1ZhS3JLM2pHVU9fSkp4SC5BZnMzaFRnSjNWTWNLQ2IzODVlcklhZVQ0aFczRzVGUHBPZXRQYnlST0p4RFV2bjFNQXQ3SEt6cXl5MlVLTEE0QkRZOGZPMVNHUXl5ZVkwTk16RG55djY1Rkk1VFUwOUpTSzFJOVk0U0J4Wk9qQmdyanhHMk01bkRXS3NteWFmOFVHSU9DUjhUR09sTzNTZ2pNQlpfWldzUGhjX0ZCdkRZWWh3WmFnS3Z5dGRQaGtGdWFoTTVSRDI2T1lHSXN3LXpqQVpoRVVKcEJlczdTZWF1RDNyRndkb3ZHQmw5ZVFDejF0dGFNZG1nVUpKWVhwRjMzblVybHU5amIwVzNIUG5JNlRSV0V3VDBkaTg1UFQwTjE3a0RQQTZoVU9TSTdFQUVGMVNxdjdkbDM5UHJBX1BsNEZBUlYxSlM5MFdnT0s2YmpjbHduenIxZjN2N1VhdlpNTHc2cEdBZ3Y0T01TdDlTUGZFclJNaVV5eHpweUlVVTNTdnlEM1dEVHNDb2g2SVFQaS1KUWZEX2dtOTNvZzhjVWRqX0hqczhVcDBIcnJ4NU54RktKUFlOQ2xUVXdnTnpISUVuN21FcEwwWktzU2NFbUpTVmlhWmx3dGU3bmxMWUhLeEhwakowa0NURVBmVEhZZ2VFMWRKUEZaQlB6VXRBUlVZUERrYi1qM3pZZzZPVkszWGU4cU92SXl5QTBKR1Y5VDRwYUJ2bm1aM0hvREZOR1Q5RXc1WkU3ekRjNzB6aDM0MDhURGJsVk5WZEhNT0lGREJrODlLYmN1WGpLSWNJR0w4OTE3QkNmR0tlanAxWG5MbzRHZ0hrUXdoZWdjMGxvY0dmWEZUbDN4eW1heWhQM0xxbHF2Qm4zMkpOc3FzWmVUMlJJdXRkdlZuNHg3aUQ3QmpBWk5yLUptS0M2X0t3dWoxUjBZUTdxSkNQREpvd1doNk9SNDhLNlEzYmhoTXRKUS5JdFN2NVZLblR3WFUyUTFORmwyd1VRIg0KfQ0KDQoNCg0K.sMk004CzMvjLf5tDOZyWhEoB77Khlq-lIedB81qfArE',
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
            'https://motor-core.cetelem.com.br/api/Script/Run',
            {
                ScriptName: 'identify-assinatura-digital\\callback-pdf64',
                ScriptParameters: {
                    sessionId,
                    clientId,
                    docPDF,
                },
                Token: '4d2448a3-f53b-4221-9117-590ad833f0c4',
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

    async function _transformDocumentAndSendToP3(signedDocumentsUrl, contract) {
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
