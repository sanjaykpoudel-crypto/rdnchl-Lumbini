/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
// Locks the NCHL setup and audit records:
// - NCHL API Log: written only by the payment scripts; nobody edits or deletes a row
// - NCHL Payment Settings (who may pay): only Administrators add, change or delete it
define(['N/error', './rdmodule'], function (error, rdmodu) {
    const API_LOG = 'customrecord_lc_nchl_api_log'
    const SETTINGS = 'customrecord_lc_nchl_pay_settings'

    function guard(context) {
        const types = context.UserEventType
        const recType = (context.newRecord || context.oldRecord).type
        if (recType === API_LOG) {
            const byPerson = !rdmodu.isscripted()
            if (context.type === types.DELETE || ([types.CREATE, types.COPY, types.EDIT, types.XEDIT].includes(context.type) && byPerson)) {
                throw error.create({
                    name: 'NCHL_API_LOG_LOCKED',
                    message: 'The NCHL API log is written only by the NCHL payment scripts and cannot be added, edited or deleted.',
                    notifyOff: true
                })
            }
        } else if (recType === SETTINGS) {
            if ([types.CREATE, types.COPY, types.EDIT, types.XEDIT, types.DELETE].includes(context.type) && !rdmodu.isadmin()) {
                throw error.create({
                    name: 'NCHL_SETTINGS_LOCKED',
                    message: 'Only an Administrator can change NCHL Payment Settings.',
                    notifyOff: true
                })
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
