/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
// Locks the NCHL setup and audit records:
// - NCHL API Log: written only by the payment scripts; nobody edits or deletes a row
// - NCHL Payment Settings (who may pay): only Administrators add, change or delete it
define(['./rdmodule'], function (rdmodu) {
    const API_LOG = 'customrecord_lc_nchl_api_log'
    const SETTINGS = 'customrecord_lc_nchl_pay_settings'

    // thrown as plain messages: NetSuite shows a thrown SuiteScriptError as raw JSON with its stack
    function guard(context) {
        const types = context.UserEventType
        const recType = (context.newRecord || context.oldRecord).type
        if (recType === API_LOG) {
            // the payment scripts write it, and delete it only together with a failed attempt (Delete Failed Attempt)
            const byPerson = !rdmodu.isscripted()
            if ([types.CREATE, types.COPY, types.EDIT, types.XEDIT, types.DELETE].includes(context.type) && byPerson) {
                throw 'The NCHL API log is written only by the NCHL payment scripts and cannot be added, edited or deleted.'
            }
        } else if (recType === SETTINGS) {
            if ([types.CREATE, types.COPY, types.EDIT, types.XEDIT, types.DELETE].includes(context.type) && !rdmodu.isadmin()) {
                throw 'Only an Administrator can change NCHL Payment Settings.'
            }
        }
    }

    return {
        beforeLoad: context => {
            guard(context)
            if (context.type === context.UserEventType.VIEW && context.newRecord.type === API_LOG) {
                rdmodu.hideeditbutton(context.form)
            }
        },
        beforeSubmit: guard
    }
})
