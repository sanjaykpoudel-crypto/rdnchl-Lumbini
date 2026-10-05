/**
 * @NApiVersion 2.1
 * @NScriptType Scheduledscript
 */
define(['N/runtime', 'N/record', './rdmodule'], function (runtime, record, rdmodu) {
    return {
        execute: context => {
            const script = runtime.getCurrentScript()
            const paramsRaw = script.getParameter({
                name: 'custscript_lc_nchl_script_params'
            })
            const params = JSON.parse(paramsRaw)
            // accepts {type, records} (bank transfer) or a bare array of records (vendor payments)
            const records = Array.isArray(params) ? params : params.records
            log.debug('SCHEDULE_RECORDS', params.type || 'payment')
            records.forEach(pr => {
                // one failing record must not stop the rest of the run
                try {
                    log.debug('SCHEDULE_PMT_RECs', pr)
                    const tranRecord = record.load({
                        type: pr.recordtype,
                        id: pr.recordid
                    })
                    const activeTran = rdmodu.getactivenchltran(pr.recordid)
                    if (tranRecord.getValue('custbody_rdnchl_paid_online') || activeTran) {
                        log.audit('SKIP_ALREADY_SUBMITTED', {record: pr, nchltran: activeTran})
                        return
                    }
                    const paymentType = tranRecord.getValue('custbody_nchl_payment_type') === '1' ? 'CIPS' : 'IPS'
                    const fromAccount = tranRecord.getValue('account') || tranRecord.getValue('fromaccount')
                    const drBankDetail = rdmodu.getcoabankdetail(fromAccount, paymentType)
                    // vendor payments carry the vendor's NCHL bank record, bank transfers carry the receiving GL account
                    const crBankRecordId = tranRecord.getValue('custbody_rdnchl_bank')
                    const crBankDetail = crBankRecordId
                        ? rdmodu.getbankdetail(crBankRecordId)
                        : rdmodu.getcoabankdetail(tranRecord.getValue('toaccount'), paymentType)
                    const batch = {
                        paymenttype: paymentType,
                        amount: tranRecord.getValue('total') || tranRecord.getValue('payment') || tranRecord.getValue('fromamount'),
                        purpose: 'CUST',
                        drbank: JSON.parse(drBankDetail.custrecord_rdnchl_bank_prop).value,
                        drbankbranch: JSON.parse(drBankDetail.custrecord_rdnchl_bank_branch_prop).value,
                        draccountname: drBankDetail.custrecord_rdnchl_account_name,
                        draccount: drBankDetail.custrecord_rdnchl_account_number,
                        remarks: tranRecord.getValue('memo') || tranRecord.getValue('tranid'),
                        crbank: JSON.parse(crBankDetail.custrecord_rdnchl_bank_prop).value,
                        crbankbranch: JSON.parse(crBankDetail.custrecord_rdnchl_bank_branch_prop).value,
                        craccountname: crBankDetail.custrecord_rdnchl_account_name,
                        craccount: crBankDetail.custrecord_rdnchl_account_number
                    }
                    log.debug('BATCH_DETAIL', batch)
                    const relRecProp = {
                        type: pr.recordtype,
                        id: pr.recordid
                    }
                    const nchlTranRecord = rdmodu.savenchltran({
                        relrecord: JSON.stringify(relRecProp),
                        params: batch
                    })
                    log.debug('saved record id', 'record id = ' + nchlTranRecord)
                    if (nchlTranRecord) {
                        // post*batch returns a string when the request itself failed
                        const nchlResponse = paymentType === 'CIPS'
                            ? rdmodu.postcipsbatch(nchlTranRecord)
                            : rdmodu.postipsbatch(nchlTranRecord)
                        const responseText = typeof nchlResponse === 'string' ? nchlResponse : nchlResponse.body
                        rdmodu.updaterelrecord({
                            type: 'customrecord_nchl_transaction',
                            id: nchlTranRecord,
                            values: {custrecord_nchl_tran_response: responseText}
                        })
                        if (rdmodu.gettranstatus(responseText).status === 'SUCCESS') {
                            relRecProp.values = {custbody_rdnchl_paid_online: true}
                            rdmodu.updaterelrecord(relRecProp)
                        }
                    }
                } catch (e) {
                    log.error('SCHEDULE_ERROR', {record: pr, error: e})
                }
            })
        }
    }
})
