/**
 * @NApiVersion 2.1
 * @NScriptType Scheduledscript
 */
define(['N/runtime', 'N/record', 'N/search', './rdmodule'], function (runtime, record, search, rdmodu) {
    function getbankdetail(recordid) {
        return search.lookupFields({
            type: search.Type.ACCOUNT,
            id: recordid,
            columns: [
                'custrecord_rdnchl_coa_bank_detail.custrecord_nchl_bank_type',
                'custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_bank_prop',
                'custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_bank_branch_prop',
                'custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_account_name',
                'custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_account_number'
            ]
        })
    }

    return {
        execute: context => {
            try {
                const script = runtime.getCurrentScript()
                const paramsRaw = script.getParameter({
                    name: 'custscript_nchl_script_params'
                })
                const params = JSON.parse(paramsRaw)
                log.debug('SCHEDULE_RECORDS', params.type)
                params.records.forEach(pr => {
                    log.debug('SCHEDULE_PMT_RECs', pr)
                    const tranRecord = record.load({
                        type: pr.recordtype,
                        id: pr.recordid
                    })
                    const fromAccount = tranRecord.getValue('account') || tranRecord.getValue('fromaccount')
                    const drBankDetail = getbankdetail(fromAccount)
                    const crBankRecordId = tranRecord.getValue('custbody_rdnchl_bank') || tranRecord.getValue('toaccount')
                    const crBankDetail = getbankdetail(crBankRecordId)
                    const paymentType = tranRecord.getValue('custbody_nchl_payment_type') === '1' ? 'CIPS' : 'IPS'
                    const batch = {
                        paymenttype: paymentType,
                        amount: tranRecord.getValue('total') || tranRecord.getValue('payment') || tranRecord.getValue('fromamount'),
                        purpose: 'CUST',
                        drbank: JSON.parse(drBankDetail['custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_bank_prop']).value,
                        drbankbranch: JSON.parse(drBankDetail['custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_bank_branch_prop']).value,
                        draccountname: drBankDetail['custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_account_name'],
                        draccount: drBankDetail['custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_account_number'],
                        remarks: tranRecord.getValue('memo') || tranRecord.getValue('tranid'),
                        crbank: JSON.parse(crBankDetail['custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_bank_prop']).value,
                        crbankbranch: JSON.parse(crBankDetail['custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_bank_branch_prop']).value,
                        craccountname: crBankDetail['custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_account_name'],
                        craccount: crBankDetail['custrecord_rdnchl_coa_bank_detail.custrecord_rdnchl_account_number']
                    }
                    log.debug('BATCH_DETAIL', batch)
                    const nchlTranRecord = rdmodu.savenchltran({
                        relrecord: JSON.stringify({
                            type: pr.recordtype,
                            id: pr.recordid
                        }),
                        params: batch
                    })
                    log.debug('saved record id', 'record id = ' + nchlTranRecord)
                    ////TODO: LATER
                    if (nchlTranRecord) {
                        let response = {type: 'nothing', resp: null}
                        if (paymentType === 'CIPS') {
                            const cipsResponse = rdmodu.postcipsbatch(nchlTranRecord)
                            response.type = 'CIPS'
                            response.resp = cipsResponse
                            const respBody = JSON.parse(cipsResponse.body)
                            if (respBody.cipsBatchResponse.responseCode === '000' && respBody.cipsTxnResponseList[0].creditStatus === '000') {
                                relRecProp.values = {custbody_rdnchl_paid_online: true}
                                const parentRecord = rdmodu.updaterelrecord(relRecProp)
                            }
                            const tranRecord = rdmodu.updaterelrecord({
                                type: 'customrecord_nchl_transaction',
                                id: nchlTranRecord,
                                values: {custrecord_nchl_tran_response: cipsResponse.body}
                            })
                        } else if (paymentType === 'IPS') {
                            const ipsResponse = rdmodu.postipsbatch(nchlTranRecord)
                            response.type = 'ISP'
                            response.resp = ipsResponse
                            const tranRecord = rdmodu.updaterelrecord({
                                type: 'customrecord_nchl_transaction',
                                id: nchlTranRecord,
                                values: {custrecord_nchl_tran_response: ipsResponse.body}
                            })
                        }
                    }

                })
                /*params.forEach(param => {
                    log.debug('REC_PARAM', param)

                })*/
            } catch (e) {
                log.error('SCHEDULE_ERROR', e)
            }
        }
    }
})