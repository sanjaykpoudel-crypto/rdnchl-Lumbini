/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
// NCHL Bank Balances and Statement, read only:
// - balances: every company bank account linked to an NCHL bank detail, with NCHL's available and ledger balance
//   (balance enquiry) next to the NetSuite GL balance
// - statement: the bank's statement of one account for a date range (fetch account statement), lines already paid
//   through NCHL marked, downloadable as a CSV for NetSuite's bank data import (Match Bank Data)
// Only Allowed Payers (NCHL Payment Settings) may open it.
define(['N/ui/serverWidget', 'N/search', 'N/url', 'N/format', 'N/redirect', 'N/file', './rdmodule'],
    function (serverWidget, search, url, format, redirect, file, rdmod) {
        const TITLE = 'NCHL Bank Balances'
        const SCRIPT = {scriptId: 'customscript_lc_nchl_bank_report', deploymentId: 'customdeploy_lc_nchl_bank_report'}
        // NCHL ids shorter than this (e.g. end-to-end id "79-1") would match unrelated statement text
        const MIN_MATCH_LENGTH = 8

        function escapehtml(text) {
            return String(text === null || text === undefined ? '' : text)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        }

        // NCHL writes statement amounts with Nepali grouping, e.g. "2,10,358.77"
        function amountof(value) {
            return parseFloat(String(value === null || value === undefined ? '' : value).replace(/,/g, '')) || 0
        }

        function money(amount) {
            return format.format({value: Math.round(amountof(amount) * 100) / 100, type: format.Type.CURRENCY})
        }

        function pagelink(params) {
            return url.resolveScript(Object.assign({params: params}, SCRIPT))
        }

        /**
         * Company bank accounts linked to an NCHL bank detail (the accounts NetSuite pays from)
         * @param {string} [onlyId] one GL account
         * @returns {{id, name, nsBalance, bankId, bankName, branchId, branchName, accountNumber, accountName, problem}[]}
         */
        function getbankaccounts(onlyId) {
            const filters = [['custrecord_rdnchl_coa_bank_detail', 'noneof', '@NONE@'], 'AND', ['isinactive', 'is', 'F']]
            if (onlyId) {
                filters.push('AND', ['internalid', 'anyof', onlyId])
            }
            const accounts = []
            search.create({
                type: search.Type.ACCOUNT,
                filters: filters,
                columns: [search.createColumn({name: 'name', sort: search.Sort.ASC}), 'balance']
            }).run().each(result => {
                const name = result.getValue('name')
                // "Cash & Cash Equivalent : Bank Balance : Everest Bank Ltd : Everest Bank - Current Account" -> the last part
                const account = {id: result.id, name: name, shortName: String(name).split(' : ').pop(), nsBalance: parseFloat(result.getValue('balance')) || 0, problem: ''}
                try {
                    const detail = rdmod.getcoabankdetail(result.id, 'CIPS')
                    const bank = JSON.parse(detail.custrecord_rdnchl_bank_prop || '{}')
                    const branch = JSON.parse(detail.custrecord_rdnchl_bank_branch_prop || '{}')
                    Object.assign(account, {
                        bankId: bank.value, bankName: bank.text, branchId: branch.value, branchName: branch.text,
                        accountNumber: detail.custrecord_rdnchl_account_number, accountName: detail.custrecord_rdnchl_account_name
                    })
                } catch (e) {
                    account.problem = e.message
                }
                accounts.push(account)
                return true
            })
            return accounts
        }

        const PAGE_CSS = `<style>
            .lc-cards{display:flex;gap:12px;margin:4px 0 16px;color:#1f2937;font:13px/18px Arial,Helvetica,sans-serif}
            .lc-cards *{box-sizing:border-box;font-family:inherit}
            .lc-box{flex:1 1 0;min-width:0;border:1px solid #d0d7de;border-radius:6px;background:#fff;padding:12px 16px}
            .lc-label{font-size:11px;line-height:18px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:8px}
            .lc-big{font-size:20px;line-height:26px;font-weight:bold;margin-bottom:4px}
            .lc-text{font-size:13px;line-height:18px}
            .lc-sub{font-size:12px;line-height:18px;color:#6b7280}
            .lc-row{display:flex;justify-content:space-between;gap:8px;font-size:13px;line-height:18px;padding:2px 0}
            .lc-row span:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}
            .lc-bad{color:#b91c1c}
            @media (max-width:900px){.lc-cards{flex-direction:column}}
            </style>`

        function addhtml(form, id, html, container) {
            const field = form.addField({id: id, label: id, type: serverWidget.FieldType.INLINEHTML, container: container})
            field.defaultValue = html
            return field
        }

        function addmessage(form, id, text, bad) {
            addhtml(form, id, `${PAGE_CSS}<div class="lc-cards"><div class="lc-box"><div class="lc-text${bad ? ' lc-bad' : ''}">${text}</div></div></div>`)
                .updateLayoutType({layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE})
        }

        /**
         * Overview: one row per company account, NCHL's balance next to NetSuite's
         */
        function writebalances() {
            const form = serverWidget.createForm({title: TITLE})
            const accounts = getbankaccounts()
            const rows = accounts.map(account => {
                if (account.problem) {
                    return Object.assign({nchl: {ok: false, message: account.problem}}, account)
                }
                let nchl
                try {
                    nchl = rdmod.getaccountbalance(account)
                } catch (e) {
                    nchl = {ok: false, message: e.message || String(e)}
                }
                return Object.assign({nchl: nchl}, account)
            })
            const answered = rows.filter(row => row.nchl.ok)
            const sum = (list, pick) => list.reduce((total, row) => total + pick(row), 0)
            addhtml(form, 'custpage_summary', `${PAGE_CSS}<div class="lc-cards">
                <div class="lc-box"><div class="lc-label">Available at the banks (NCHL)</div>
                    <div class="lc-big">NPR ${escapehtml(money(sum(answered, row => row.nchl.available)))}</div>
                    <div class="lc-sub">${answered.length} of ${rows.length} accounts answered</div></div>
                <div class="lc-box"><div class="lc-label">Ledger balance at the banks</div>
                    <div class="lc-big">NPR ${escapehtml(money(sum(answered, row => row.nchl.ledger)))}</div>
                    <div class="lc-sub">Includes amounts the bank holds or has not cleared</div></div>
                <div class="lc-box"><div class="lc-label">NetSuite balance (same accounts)</div>
                    <div class="lc-big">NPR ${escapehtml(money(sum(answered, row => row.nsBalance)))}</div>
                    <div class="lc-sub">Difference to the banks: NPR ${escapehtml(money(sum(answered, row => row.nsBalance - row.nchl.ledger)))}</div></div>
                </div>`).updateLayoutType({layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE})

            const list = form.addSublist({id: 'custpage_accounts', label: 'Bank Accounts', type: serverWidget.SublistType.LIST})
            const columns = [
                ['custpage_account', 'NetSuite Account', serverWidget.FieldType.TEXT],
                ['custpage_bank', 'Bank / Branch', serverWidget.FieldType.TEXT],
                ['custpage_number', 'Account Number', serverWidget.FieldType.TEXT],
                ['custpage_available', 'Available (NCHL)', serverWidget.FieldType.CURRENCY],
                ['custpage_ledger', 'Ledger (NCHL)', serverWidget.FieldType.CURRENCY],
                ['custpage_ns', 'NetSuite Balance', serverWidget.FieldType.CURRENCY],
                ['custpage_diff', 'Difference', serverWidget.FieldType.CURRENCY],
                ['custpage_answer', 'NCHL Answer', serverWidget.FieldType.TEXT],
                ['custpage_statement', 'Statement', serverWidget.FieldType.TEXT]
            ]
            columns.forEach(([id, label, type]) => list.addField({id: id, label: label, type: type}))
            rows.forEach((row, line) => {
                const set = (id, value) => {
                    if (value !== '' && value !== null && value !== undefined) {
                        list.setSublistValue({id: id, line: line, value: String(value)})
                    }
                }
                set('custpage_account', `<span title="${cut(row.name)}">${cut(row.shortName, 120)}</span>`)
                set('custpage_bank', cut([row.bankName, row.branchName].filter(Boolean).join(' · ')))
                set('custpage_number', escapehtml(row.accountNumber))
                set('custpage_ns', row.nsBalance)
                if (row.nchl.ok) {
                    set('custpage_available', row.nchl.available)
                    set('custpage_ledger', row.nchl.ledger)
                    set('custpage_diff', Math.round((row.nsBalance - row.nchl.ledger) * 100) / 100)
                    set('custpage_answer', 'OK')
                } else {
                    set('custpage_answer', `<span style="color:#b91c1c">${cut(row.nchl.message, 240)}</span>`)
                }
                if (!row.problem) {
                    set('custpage_statement', `<a href="${escapehtml(pagelink({account: row.id}))}">View statement</a>`)
                }
            })
            if (rows.length === 0) {
                addmessage(form, 'custpage_none', 'No bank account is linked to an NCHL Bank Detail yet. Link one on the account (Chart of Accounts) first.')
            }
            form.addButton({id: 'custpage_refresh', label: 'Refresh', functionName: `(function () { window.location.href = '${pagelink({})}' })`})
            return form
        }

        function todate(value) {
            try {
                const date = value ? format.parse({value: value, type: format.Type.DATE}) : null
                return date instanceof Date && !isNaN(date) ? date : null
            } catch (e) {
                return null
            }
        }

        /**
         * Escaped text that fits a list cell (300 characters including the HTML around it)
         * @param {string} text
         * @param {number} [room] characters left for the escaped text
         */
        function cut(text, room = 250) {
            const value = String(text === null || text === undefined ? '' : text)
            if (escapehtml(value).length <= room) {
                return escapehtml(value)
            }
            let length = Math.min(value.length, room)
            while (length > 0 && escapehtml(value.slice(0, length)).length + 1 > room) {
                length--
            }
            return escapehtml(value.slice(0, length).replace(/\s+$/, '')) + '…'
        }

        function isodate(date) {
            const pad = n => (n < 10 ? '0' : '') + n
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        }

        /**
         * NCHL's date in the user's date format: yyyy-MM-dd (period) or dd-MM-yyyy (statement lines), time ignored
         */
        function nsdate(text) {
            const value = String(text || '')
            const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
            const dmy = /^(\d{2})-(\d{2})-(\d{4})/.exec(value)
            const date = iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]) : dmy ? new Date(+dmy[3], +dmy[2] - 1, +dmy[1]) : null
            return date ? format.format({value: date, type: format.Type.DATE}) : value
        }

        /**
         * NCHL sends the opening and closing balance as statement lines without a date: keep them apart from the
         * transactions
         */
        function splitlines(statements) {
            const result = {opening: null, closing: null, lines: []}
            ;(Array.isArray(statements) ? statements : []).forEach(line => {
                const label = String(line.description || line.remarks || '').trim().toLowerCase()
                if (!line.tranDate && label === 'opening balance') {
                    result.opening = line
                } else if (!line.tranDate && label === 'closing balance') {
                    result.closing = line
                } else {
                    result.lines.push(line)
                }
            })
            return result
        }

        /**
         * NCHL transactions created around the period, with the ids NCHL may print on the statement
         * (batch, instruction, end-to-end id)
         */
        function getnchlrefs(from, to) {
            const day = 24 * 60 * 60 * 1000
            const refs = []
            search.create({
                type: 'customrecord_nchl_transaction',
                filters: [['created', 'within', format.format({value: new Date(from.getTime() - 3 * day), type: format.Type.DATE}),
                    format.format({value: new Date(to.getTime() + 3 * day), type: format.Type.DATE})]],
                columns: ['name', 'custrecord_nchl_tran_batch', 'custrecord_nchl_tran_instruction']
            }).run().each(result => {
                const keys = new Set()
                const collect = value => {
                    if (Array.isArray(value)) {
                        value.forEach(collect)
                    } else if (value && typeof value === 'object') {
                        ['batchId', 'instructionId', 'endToEndId'].forEach(key => {
                            if (value[key] && String(value[key]).length >= MIN_MATCH_LENGTH) {
                                keys.add(String(value[key]).toUpperCase())
                            }
                        })
                        Object.keys(value).forEach(key => typeof value[key] === 'object' && collect(value[key]))
                    }
                }
                ;['custrecord_nchl_tran_batch', 'custrecord_nchl_tran_instruction'].forEach(fieldId => {
                    try {
                        collect(JSON.parse(result.getValue(fieldId) || 'null'))
                    } catch (e) {
                        // not JSON: nothing to match on
                    }
                })
                if (keys.size > 0) {
                    refs.push({id: result.id, name: result.getValue('name'), keys: [...keys]})
                }
                return true
            })
            return refs
        }

        function matchline(line, refs) {
            const text = [line.description, line.remarks, line.referenceNo, line.tranId, line.chequeNo].join(' ').toUpperCase()
            return refs.find(ref => ref.keys.some(key => text.indexOf(key) >= 0)) || null
        }

        /**
         * The period asked for (from/to in the user's date format); the current month by default
         */
        function readperiod(params) {
            const today = new Date()
            const from = todate(params.from) || new Date(today.getFullYear(), today.getMonth(), 1)
            const to = todate(params.to) || today
            return {from: from, to: to}
        }

        function fetchstatement(account, period) {
            if (account.problem) {
                return {ok: false, message: account.problem}
            }
            try {
                return rdmod.getaccountstatement({
                    bankCode: account.bankId,
                    accountNumber: account.accountNumber,
                    fromDate: isodate(period.from),
                    toDate: isodate(period.to)
                })
            } catch (e) {
                return {ok: false, message: e.message || String(e)}
            }
        }

        /**
         * One account's statement for the chosen period
         */
        function writestatement(params) {
            const form = serverWidget.createForm({title: 'NCHL Bank Statement'})
            const accounts = getbankaccounts()
            const account = accounts.find(a => a.id === String(params.account)) || accounts[0]
            const period = readperiod(params)

            form.addFieldGroup({id: 'filters', label: 'Statement'})
            const accountField = form.addField({id: 'custpage_account', label: 'Bank Account', type: serverWidget.FieldType.SELECT, container: 'filters'})
            accounts.forEach(a => accountField.addSelectOption({value: a.id, text: a.shortName, isSelected: account && a.id === account.id}))
            accountField.isMandatory = true
            const fromField = form.addField({id: 'custpage_from', label: 'From Date', type: serverWidget.FieldType.DATE, container: 'filters'})
            fromField.defaultValue = format.format({value: period.from, type: format.Type.DATE})
            fromField.isMandatory = true
            // account, from and to side by side
            fromField.updateBreakType({breakType: serverWidget.FieldBreakType.STARTCOL})
            const toField = form.addField({id: 'custpage_to', label: 'To Date', type: serverWidget.FieldType.DATE, container: 'filters'})
            toField.defaultValue = format.format({value: period.to, type: format.Type.DATE})
            toField.isMandatory = true
            toField.updateBreakType({breakType: serverWidget.FieldBreakType.STARTCOL})
            form.addSubmitButton({label: 'Show Statement'})
            form.addButton({id: 'custpage_balances', label: 'All Balances', functionName: `(function () { window.location.href = '${pagelink({})}' })`})

            if (!account) {
                addmessage(form, 'custpage_none', 'No bank account is linked to an NCHL Bank Detail yet.')
                return form
            }
            if (period.from > period.to) {
                addmessage(form, 'custpage_dates', 'From Date is after To Date.', true)
                return form
            }
            const statement = fetchstatement(account, period)
            if (!statement.ok) {
                addmessage(form, 'custpage_error', `NCHL did not return the statement of ${escapehtml(account.shortName)}: <b>${escapehtml(statement.message)}</b>`, true)
                return form
            }
            const data = statement.data
            const parts = splitlines(data.statements)
            const lines = parts.lines
            const refs = getnchlrefs(period.from, period.to)
            const totalDebit = lines.reduce((t, l) => t + amountof(l.debit), 0)
            const totalCredit = lines.reduce((t, l) => t + amountof(l.credit), 0)
            const balancerow = (label, line) => line
                ? `<div class="lc-row"><span>${label}</span><span>${escapehtml(money(line.balance))}</span></div>` : ''
            const matched = lines.filter(l => matchline(l, refs)).length

            addhtml(form, 'custpage_summary', `${PAGE_CSS}<div class="lc-cards">
                <div class="lc-box"><div class="lc-label">Account</div>
                    <div class="lc-text"><b>${escapehtml(data.accountName || account.accountName)}</b></div>
                    <div class="lc-text">${escapehtml(data.accountNumber || account.accountNumber)}</div>
                    <div class="lc-sub">${escapehtml([account.bankName, data.branchName && data.branchName !== '-' ? data.branchName : account.branchName, data.accountType].filter(Boolean).join(' · '))}</div></div>
                <div class="lc-box"><div class="lc-label">${escapehtml(nsdate(data.startDate || isodate(period.from)))} to ${escapehtml(nsdate(data.endDate || isodate(period.to)))}</div>
                    ${balancerow('Opening balance', parts.opening)}
                    <div class="lc-row"><span>Money in (${lines.filter(l => amountof(l.credit)).length})</span><span>${escapehtml(money(totalCredit))}</span></div>
                    <div class="lc-row"><span>Money out (${lines.filter(l => amountof(l.debit)).length})</span><span>${escapehtml(money(totalDebit))}</span></div>
                    ${balancerow('Closing balance', parts.closing)}
                    <div class="lc-row"><span>Paid through NCHL from NetSuite</span><span>${matched}</span></div></div>
                <div class="lc-box"><div class="lc-label">Balance now</div>
                    <div class="lc-big">${escapehtml(data.currency || 'NPR')} ${escapehtml(money(data.accountBalance))}</div>
                    <div class="lc-sub">NetSuite balance: NPR ${escapehtml(money(account.nsBalance))}</div></div>
                </div>`).updateLayoutType({layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW})

            const list = form.addSublist({id: 'custpage_lines', label: `Statement Lines (${lines.length})`, type: serverWidget.SublistType.LIST})
            ;[
                ['custpage_date', 'Date', serverWidget.FieldType.TEXT],
                ['custpage_value_date', 'Value Date', serverWidget.FieldType.TEXT],
                ['custpage_description', 'Description', serverWidget.FieldType.TEXT],
                ['custpage_remarks', 'Remarks', serverWidget.FieldType.TEXT],
                ['custpage_cheque', 'Cheque No', serverWidget.FieldType.TEXT],
                ['custpage_debit', 'Money Out', serverWidget.FieldType.CURRENCY],
                ['custpage_credit', 'Money In', serverWidget.FieldType.CURRENCY],
                ['custpage_balance', 'Balance', serverWidget.FieldType.CURRENCY],
                ['custpage_nchl', 'NCHL Transaction', serverWidget.FieldType.TEXT]
            ].forEach(([id, label, type]) => list.addField({id: id, label: label, type: type}))
            lines.forEach((line, index) => {
                const set = (id, value) => {
                    if (value !== '' && value !== null && value !== undefined) {
                        list.setSublistValue({id: id, line: index, value: String(value)})
                    }
                }
                // banks that give no time send 00:00:00
                const time = /\s(\d{2}:\d{2})/.exec(String(line.tranDate || ''))
                set('custpage_date', escapehtml(nsdate(line.tranDate) + (time && time[1] !== '00:00' ? ' ' + time[1] : '')))
                set('custpage_value_date', escapehtml(nsdate(line.valueDate)))
                set('custpage_description', cut(line.description))
                set('custpage_remarks', cut(line.remarks))
                set('custpage_cheque', cut(line.chequeNo))
                if (amountof(line.debit)) {
                    set('custpage_debit', amountof(line.debit))
                }
                if (amountof(line.credit)) {
                    set('custpage_credit', amountof(line.credit))
                }
                if (line.balance !== null && line.balance !== undefined && line.balance !== '') {
                    set('custpage_balance', amountof(line.balance))
                }
                const ref = matchline(line, refs)
                if (ref) {
                    const link = url.resolveRecord({recordType: 'customrecord_nchl_transaction', recordId: ref.id})
                    set('custpage_nchl', `<a href="${escapehtml(link)}" target="_blank">${escapehtml(ref.name)}</a>`)
                }
            })
            if (lines.length === 0) {
                addmessage(form, 'custpage_empty', 'The bank returned no transactions for this period.')
            } else {
                const csvLink = pagelink({account: account.id, from: format.format({value: period.from, type: format.Type.DATE}),
                    to: format.format({value: period.to, type: format.Type.DATE}), csv: 'T'})
                form.addButton({id: 'custpage_csv', label: 'Download for Bank Import', functionName: `(function () { window.location.href = '${csvLink}' })`})
            }
            return form
        }

        /**
         * The statement as a CSV in NetSuite's bank data import layout (Banking > Import Bank Data)
         */
        function writecsv(context, params) {
            const account = getbankaccounts(params.account)[0]
            const period = readperiod(params)
            const statement = account ? fetchstatement(account, period) : {ok: false, message: 'Unknown bank account'}
            if (!statement.ok) {
                context.response.write(`NCHL did not return the statement: ${statement.message}`)
                return
            }
            const cell = value => {
                const text = String(value === null || value === undefined ? '' : value)
                return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
            }
            const amount = value => (amountof(value) ? (Math.round(amountof(value) * 100) / 100).toFixed(2) : '')
            const rows = [['Date', 'Description', 'Reference No', 'Transaction Id', 'Deposit', 'Withdrawal', 'Bank Party Name',
                'Bank Party Account Number', 'Bank Party IBAN']]
            splitlines(statement.data.statements).lines.forEach(line => {
                rows.push([nsdate(line.tranDate), line.description, line.referenceNo || line.remarks || line.chequeNo, line.tranId,
                    amount(line.credit), amount(line.debit), '', '', ''])
            })
            context.response.writeFile({
                file: file.create({
                    name: `statement_${account.accountNumber}_${isodate(period.from)}_${isodate(period.to)}.csv`,
                    fileType: file.Type.CSV,
                    contents: rows.map(row => row.map(cell).join(',')).join('\r\n')
                }),
                isInline: false
            })
        }

        return {
            onRequest: context => {
                const params = context.request.parameters
                if (!rdmod.canpay()) {
                    const denied = serverWidget.createForm({title: TITLE})
                    addmessage(denied, 'custpage_denied', 'Only Allowed Payers (NCHL Payment Settings) can see NCHL bank balances and statements. ' +
                        'An Administrator can add you.', true)
                    context.response.writePage({pageObject: denied})
                    return
                }
                if (context.request.method === 'POST') {
                    // Show Statement: back to a plain link, so the page can be refreshed and bookmarked
                    redirect.toSuitelet(Object.assign({parameters: {account: params.custpage_account, from: params.custpage_from, to: params.custpage_to}}, SCRIPT))
                    return
                }
                try {
                    if (params.csv === 'T') {
                        writecsv(context, params)
                    } else {
                        context.response.writePage({pageObject: params.account ? writestatement(params) : writebalances()})
                    }
                } catch (e) {
                    log.error('NCHL_BANK_REPORT_ERROR', e)
                    const form = serverWidget.createForm({title: TITLE})
                    addmessage(form, 'custpage_error', escapehtml(e.message || JSON.stringify(e)), true)
                    context.response.writePage({pageObject: form})
                }
            }
        }
    })
