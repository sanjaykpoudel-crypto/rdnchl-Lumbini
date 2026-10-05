/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/search', 'N/runtime', './rdmodule'], function (search, runtime, rdmodu) {
    // checks IPS transactions from the last 30 days that NCHL has not settled yet
    const LOOKBACK = 'daysago30'

    return {
        execute: () => {
            const script = runtime.getCurrentScript()
            const counts = {checked: 0, SUCCESS: 0, FAILED: 0, 'IN-PROGRESS': 0, UNKNOWN: 0, errors: 0}
            search.create({
                type: 'customrecord_nchl_transaction',
                filters: [
                    ['custrecord_nchl_tran_mode', 'anyof', '2'],
                    'AND',
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['created', 'onorafter', LOOKBACK]
                ],
                columns: ['name']
            }).run().each(result => {
                if (script.getRemainingUsage() < 200) {
                    log.audit('IPS_STATUS_STOPPED', 'Low governance, the rest is checked in the next run')
                    return false
                }
                const saved = search.lookupFields({
                    type: 'customrecord_nchl_transaction',
                    id: result.id,
                    columns: ['custrecord_nchl_tran_response']
                })
                const current = rdmodu.gettranstatus(saved.custrecord_nchl_tran_response).status
                if (current !== 'IN-PROGRESS' && current !== 'UNKNOWN') {
                    return true
                }
                try {
                    const refreshed = rdmodu.refreshipsstatus(result.id)
                    counts.checked++
                    if (refreshed) counts[refreshed.status]++
                } catch (e) {
                    counts.errors++
                    log.error('IPS_STATUS_ERROR', {nchltran: result.getValue('name'), error: e.message || e})
                }
                return true
            })
            log.audit('IPS_STATUS_SUMMARY', counts)
        }
    }
})
