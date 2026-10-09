/**
 * @NApiVersion 2.1
 */
// Data for the bulk vendor payment page (process_multiple_payment_sl.js)
define(['N/search', './rdmodule'], function (search, rdmodu) {
    return {
        /**
         * Approved vendor payments / prepayments that are not paid online and have no NCHL transaction that
         * succeeded, is in progress or is unknown
         */
        getpaymentlist: function () {
            const list = []
            search.create({
                type: 'transaction',
                filters: [
                    ['type', 'anyof', 'VendPymt', 'VPrep'],
                    'AND',
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['approvalstatus', 'anyof', '2'],
                    'AND',
                    ['custbody_rdnchl_paid_online', 'is', 'F']
                ],
                columns: [
                    search.createColumn({name: 'trandate', sort: 'DESC'}),
                    'entity', 'tranid', 'amount', 'custbody_nchl_payment_type'
                ]
            }).run().each(result => {
                list.push({
                    id: result.id,
                    type: result.recordType,
                    tranid: result.getValue('tranid'),
                    entityId: result.getValue('entity'),
                    entity: result.getText('entity'),
                    trandate: result.getValue('trandate'),
                    amount: Math.abs(parseFloat(result.getValue('amount')) || 0),
                    payType: result.getValue('custbody_nchl_payment_type') === '2' ? 'IPS' : 'CIPS'
                })
                return true
            })
            const active = this.getactivetranrecords(list.map(tran => tran.id))
            return list.filter(tran => !active.has(tran.id))
        },
        /**
         * One search instead of rdmodule.getactivenchltran per row
         * @param {string[]} recordids
         * @returns {Set<string>} ids of the records that have a non-failed NCHL transaction
         */
        getactivetranrecords: function (recordids) {
            const active = new Set()
            if (recordids.length === 0) {
                return active
            }
            search.create({
                type: 'customrecord_nchl_transaction',
                filters: [
                    ['custrecord_nchl_tran_rel_record', 'anyof', recordids],
                    'AND',
                    ['isinactive', 'is', 'F']
                ],
                columns: ['custrecord_nchl_tran_rel_record', 'custrecord_nchl_tran_response']
            }).run().each(result => {
                if (rdmodu.gettranstatus(result.getValue('custrecord_nchl_tran_response')).status !== 'FAILED') {
                    active.add(String(result.getValue('custrecord_nchl_tran_rel_record')))
                }
                return true
            })
            return active
        },
        /**
         * Active, NCHL-verified bank accounts of several payees in one search
         * @param {string[]} entityids
         * @returns {Object<string, {CIPS: Object[], IPS: Object[]}>} accounts by entity id and payment type,
         *     in the shape of rdmodule.getpayeeaccounts (IPS includes CIPS accounts)
         */
        getpayeeaccountmap: function (entityids) {
            const map = {}
            if (entityids.length === 0) {
                return map
            }
            search.create({
                type: 'customrecord_rd_nchl_bank_detail',
                filters: [
                    ['custrecord_nchl_bank_entity', 'anyof', entityids],
                    'AND',
                    ['custrecord_nchl_account_verified', 'is', 'T'],
                    'AND',
                    ['isinactive', 'is', 'F']
                ],
                columns: ['custrecord_nchl_bank_entity', 'custrecord_nchl_bank_type', 'name', 'custrecord_rdnchl_bank_prop',
                    'custrecord_rdnchl_bank_branch_prop', 'custrecord_rdnchl_account_name', 'custrecord_rdnchl_account_number']
            }).run().each(result => {
                const entityId = String(result.getValue('custrecord_nchl_bank_entity'))
                const type = result.getValue('custrecord_nchl_bank_type')
                map[entityId] = map[entityId] || {CIPS: [], IPS: []}
                if (map[entityId][type]) {
                    map[entityId][type].push({
                        id: result.id,
                        type: type,
                        name: result.getValue('name'),
                        bank: JSON.parse(result.getValue('custrecord_rdnchl_bank_prop') || '{}'),
                        branch: JSON.parse(result.getValue('custrecord_rdnchl_bank_branch_prop') || '{}'),
                        accountName: result.getValue('custrecord_rdnchl_account_name'),
                        accountNumber: result.getValue('custrecord_rdnchl_account_number')
                    })
                }
                return true
            })
            // same rule as rdmodule.getpayeeaccounts: a non real time payment can use CIPS bank details too
            Object.keys(map).forEach(entityId => {
                map[entityId].IPS = rdmodu.uniqueaccounts(map[entityId].IPS.concat(map[entityId].CIPS), 'IPS')
            })
            return map
        }
    }
})
