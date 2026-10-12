/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
// Pays a government bill (IRD, SSF, CIT) from an approved journal through the NCHL NPI Billers iframe (spec v2):
// 1. the page shows NCHL's biller page in an iframe; the user enters the bill there and confirms it
// 2. NCHL hands the bill back (encrypted npiObject); NetSuite checks it against the journal and shows it
// 3. Make Payment confirms it with our bank as debtor (/api/npibiller/confirmbillerpay.do)
// The journal's credit line is the paying bank; its amount must equal the bill.
define(['N/ui/serverWidget', 'N/record', 'N/search', 'N/ui/message', 'N/redirect', 'N/cache', './rdmodule', './govbillers', './npibillersjose'],
    function (serverWidget, record, search, message, redirect, cache, rdmod, gov, jose) {
        const TITLE = 'Government Payment'
        const BILLER_FIELD = 'custbody_lc_nchl_gov_biller'
        // NCHL real-time (CIPS) limit for a payment to another bank
        const REAL_TIME_LIMIT = 2000000
        // NPI Billers sessions last one hour
        const SESSION_SECONDS = 3600

        function showmessage(form, type, title, text) {
            form.addPageInitMessage({message: message.create({type: type, title: title, message: text})})
        }

        function addinline(form, option) {
            const field = form.addField(option)
            field.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
            return field
        }

        function addhidden(form, id, value) {
            form.addField({id: id, label: id, type: serverWidget.FieldType.LONGTEXT})
                .updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                .defaultValue = value
        }

        function round(amount) {
            return Math.round((parseFloat(amount) || 0) * 100) / 100
        }

        function escapehtml(text) {
            return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        }

        function sessioncache() {
            return cache.getCache({name: 'LC_NCHL_GOV_SESSIONS', scope: cache.Scope.PROTECTED})
        }

        /**
         * Same conditions as the Pay Online button, checked again because this page can be opened or submitted directly
         */
        function getblockreason(journal) {
            const activeTran = rdmod.getactivenchltran(journal.id)
            if (activeTran) {
                return {
                    title: 'Payment already submitted',
                    message: `NCHL transaction ${activeTran.name} for this journal is ${activeTran.status}. Check its status instead of paying again.`,
                    activeTran: activeTran
                }
            }
            if (journal.getValue('approvalstatus') !== '2') {
                return {title: 'Not approved', message: 'Only approved journals can be paid online.'}
            }
            return null
        }

        /**
         * Reads the biller, the paying bank and the amount from the journal, so what is sent to NCHL comes from
         * NetSuite and not from the submitted form
         * @param {record.Record} journal
         */
        function getgovpayment(journal) {
            const problems = []
            const billerKey = gov.getbillerkey(journal.getText(BILLER_FIELD))
            if (!billerKey) {
                problems.push('Choose the NCHL Government Payment (IRD, SSF or CIT) on the journal')
            }
            const lineValue = (fieldId, line) => journal.getSublistValue({sublistId: 'line', fieldId: fieldId, line: line})
            let debtorBank = null, amount = 0, creditLines = 0
            for (let i = 0; i < journal.getLineCount({sublistId: 'line'}); i++) {
                const credit = parseFloat(lineValue('credit', i)) || 0
                if (!credit) {
                    continue
                }
                creditLines++
                if (creditLines > 1) {
                    problems.push(`Line ${i + 1}: one journal pays one government bill from one bank (credit) line`)
                    continue
                }
                amount = round(credit)
                try {
                    debtorBank = rdmod.getcoabankdetail(lineValue('account', i), 'CIPS')
                } catch (e) {
                    problems.push(`Line ${i + 1}: ${e.message}`)
                }
            }
            if (creditLines === 0) {
                problems.push('No paying (credit) bank line')
            }
            if (amount > REAL_TIME_LIMIT) {
                problems.push(`The amount is above the NCHL real-time limit (${REAL_TIME_LIMIT}). Non-real-time government payments are not supported yet.`)
            }
            return {billerKey, biller: billerKey ? gov.BILLERS[billerKey] : null, debtorBank, amount, problems}
        }

        function adddetail(form, journal, payment) {
            form.addFieldGroup({id: 'primaryinformation', label: 'PRIMARY INFORMATION'})
            // inline select on the transaction list renders as a link to the journal
            addinline(form, {id: 'custpage_created_from', label: 'Created From', type: serverWidget.FieldType.SELECT, source: 'transaction', container: 'primaryinformation'})
                .defaultValue = journal.id
            addinline(form, {id: 'custpage_biller', label: 'Government Payment', type: serverWidget.FieldType.TEXT, container: 'primaryinformation'})
                .defaultValue = payment.biller ? payment.biller.label : journal.getText(BILLER_FIELD)
            addinline(form, {id: 'custpage_amount', label: 'Amount', type: serverWidget.FieldType.CURRENCY, container: 'primaryinformation'})
                .defaultValue = payment.amount
            addinline(form, {id: 'custpage_ptype', label: 'Payment Type', type: serverWidget.FieldType.TEXT, container: 'primaryinformation'})
                .defaultValue = 'Real-Time'

            form.addFieldGroup({id: 'debtor', label: 'DEBIT DETAIL'})
            const debtor = payment.debtorBank
            const debtorDetail = {
                custpage_dr_bank: ['Bank', debtor ? JSON.parse(debtor.custrecord_rdnchl_bank_prop).text : ''],
                custpage_dr_bank_branch: ['Bank Branch', debtor ? JSON.parse(debtor.custrecord_rdnchl_bank_branch_prop).text : ''],
                custpage_dr_bank_ac_name: ['Account Name', debtor ? debtor.custrecord_rdnchl_account_name : ''],
                custpage_dr_bank_ac_number: ['Account Number', debtor ? debtor.custrecord_rdnchl_account_number : '']
            }
            Object.keys(debtorDetail).forEach(fieldId => {
                addinline(form, {id: fieldId, label: debtorDetail[fieldId][0], type: serverWidget.FieldType.TEXT, container: 'debtor'})
                    .defaultValue = debtorDetail[fieldId][1]
            })
        }

        /**
         * Builds the NPI Billers landing URL with a new session (spec v2, 4.1-4.3)
         */
        function newsession(journal) {
            const sessionId = `${gov.IFRAME.PARTICIPANT_CODE}_${jose.uuid()}`
            const params = {
                participant_code: gov.IFRAME.PARTICIPANT_CODE,
                landing_page: 'biller-all',
                channel: 'web',
                session_id: sessionId,
                token: jose.maketoken({participant_code: gov.IFRAME.PARTICIPANT_CODE, session_id: sessionId, channel: 'web'}),
                lang: 'en',
                display_error: 'embedded',
                web_type: 'iframe'
            }
            // only the session this page opened for this journal is accepted back
            sessioncache().put({key: 'journal_' + journal.id, value: sessionId, ttl: SESSION_SECONDS})
            const query = Object.keys(params).map(key => key + '=' + encodeURIComponent(params[key])).join('&')
            return {sessionId: sessionId, url: gov.IFRAME.URL + '?' + query}
        }

        /**
         * Step 1: NCHL's biller page; its submit_form_payload message posts the encrypted bill back to this page
         */
        function writebillerpage(context, journal) {
            const form = serverWidget.createForm({title: TITLE})
            const blockReason = getblockreason(journal)
            if (blockReason) {
                showmessage(form, message.Type.WARNING, blockReason.title, blockReason.message)
                return form
            }
            const payment = getgovpayment(journal)
            adddetail(form, journal, payment)
            if (payment.problems.length > 0) {
                showmessage(form, message.Type.ERROR, 'Cannot pay this journal', payment.problems.join('<br>'))
                return form
            }
            const setupGaps = gov.getiframesetupgaps()
            if (setupGaps.length > 0) {
                showmessage(form, message.Type.ERROR, 'NCHL billers not set up', 'Missing from NCHL: ' + setupGaps.join(', ') + ' (govbillers.js).')
                return form
            }
            const session = newsession(journal)
            addhidden(form, 'custpage_journal', journal.id)
            addhidden(form, 'custpage_step', 'review')
            addhidden(form, 'custpage_session', session.sessionId)
            addhidden(form, 'custpage_npiobject', '')
            form.addFieldGroup({id: 'bill', label: 'BILL'})
            form.addField({id: 'custpage_billers', label: 'NCHL Billers', type: serverWidget.FieldType.INLINEHTML, container: 'bill'})
                .defaultValue = `<iframe id="npibillers" src="${escapehtml(session.url)}"
                    style="width:100%;height:720px;border:1px solid #d0d7de"></iframe>
                    <script>
                    (function () {
                        var origin = ${JSON.stringify(gov.IFRAME.ORIGIN)}, sessionId = ${JSON.stringify(session.sessionId)}
                        window.addEventListener('message', function (event) {
                            if (event.origin !== origin) {
                                return
                            }
                            var msg = event.data
                            if (typeof msg === 'string') {
                                try {
                                    msg = JSON.parse(msg)
                                } catch (e) {
                                    return
                                }
                            }
                            if (!msg || msg.session_id !== sessionId) {
                                return
                            }
                            if (msg.type === 'submit_form_payload') {
                                var form = document.forms.main_form
                                form.elements.custpage_npiobject.value = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data)
                                document.getElementById('npibillers').style.display = 'none'
                                form.submit()
                            } else if (msg.type === 'session_expire') {
                                // a new page load starts a new session
                                window.location.reload()
                            }
                        })
                    })()
                    </script>`
            showmessage(form, message.Type.INFORMATION, 'Step 1 of 2',
                `Choose ${payment.billerKey} in the NCHL page below, enter the bill and confirm it there. Nothing is paid until you click Make Payment on the next step.`)
            return form
        }

        /**
         * The submit_form_payload data: the compact JWE, as a string or wrapped in an object
         */
        function readnpiobject(data) {
            let jwe = String(data || '').trim()
            if (jwe.charAt(0) === '{') {
                const wrapped = JSON.parse(jwe)
                jwe = wrapped.npiObject || wrapped.data || ''
            }
            if (!jwe) {
                throw new Error('NCHL did not send the bill')
            }
            return jose.opennpiobject(jwe)
        }

        /**
         * The same NCHL bill (its batch id) already paid, in progress or unknown on any record
         * @returns {string|null} name of that NCHL transaction
         */
        function findnpibatch(npiBatchId) {
            let found = null
            search.create({
                type: 'customrecord_nchl_transaction',
                filters: [
                    ['custrecord_nchl_tran_batch', 'contains', JSON.stringify({batchId: npiBatchId}).slice(1, -1)],
                    'AND',
                    ['isinactive', 'is', 'F']
                ],
                columns: ['name', 'custrecord_nchl_tran_response', 'custrecord_nchl_tran_raw_detail']
            }).run().each(result => {
                const response = result.getValue('custrecord_nchl_tran_response')
                if (!response && rdmod.isbillnotpaid(result.getValue('custrecord_nchl_tran_raw_detail'))) {
                    return true
                }
                if (rdmod.gettranstatus(response).status !== 'FAILED') {
                    found = result.getValue('name')
                    return false
                }
                return true
            })
            return found
        }

        /**
         * Step 2: open the bill NCHL sent, check it against the journal and offer Make Payment
         */
        function reviewbill(context, journal) {
            const params = context.request.parameters
            const form = serverWidget.createForm({title: TITLE})
            const blockReason = getblockreason(journal)
            if (blockReason && blockReason.activeTran) {
                redirect.toRecord({type: 'customrecord_nchl_transaction', id: blockReason.activeTran.id})
                return null
            }
            if (blockReason) {
                showmessage(form, message.Type.WARNING, blockReason.title, blockReason.message)
                return form
            }
            const payment = getgovpayment(journal)
            adddetail(form, journal, payment)
            if (payment.problems.length > 0) {
                showmessage(form, message.Type.ERROR, 'Cannot pay this journal', payment.problems.join('<br>'))
                return form
            }
            if (!params.custpage_session || params.custpage_session !== sessioncache().get({key: 'journal_' + journal.id})) {
                showmessage(form, message.Type.ERROR, 'Session expired', 'Open Pay Online on the journal again; nothing was paid.')
                return form
            }
            const npi = readnpiobject(params.custpage_npiobject)
            const bill = npi.cipsTransactionDetail || {}
            const npiBatch = npi.cipsBatchDetail || {}
            const problems = []
            if (bill.appId !== payment.biller.appId) {
                problems.push(`This journal pays ${payment.biller.label} (${payment.biller.appId}); the bill confirmed in NCHL is for ${bill.appId}.`)
            }
            const billAmount = round(bill.amount)
            if (billAmount !== payment.amount || round(npiBatch.batchAmount) !== payment.amount) {
                problems.push(`The bill is ${billAmount}, the journal ${payment.amount}. Correct the journal (or the bill) and try again.`)
            }
            const paidBefore = npiBatch.batchId ? findnpibatch(npiBatch.batchId) : null
            if (paidBefore) {
                problems.push(`This NCHL bill was already sent as NCHL transaction ${paidBefore}.`)
            }

            form.addFieldGroup({id: 'bill', label: 'BILL FROM ' + payment.billerKey})
            const shown = {}
            ;(npi.fieldLabelMapping || []).forEach(mapping => {
                const value = bill.hasOwnProperty(mapping.fieldName) ? bill[mapping.fieldName] : bill[mapping.mapField]
                const fieldId = 'custpage_bill_' + String(mapping.fieldName).toLowerCase().replace(/[^a-z0-9_]/g, '')
                if (value !== null && value !== undefined && value !== '' && !shown[fieldId]) {
                    shown[fieldId] = true
                    addinline(form, {id: fieldId, label: mapping.fieldLabel || mapping.fieldName, type: serverWidget.FieldType.TEXT, container: 'bill'})
                        .defaultValue = String(value)
                }
            })
            if (round(bill.chargeAmount) > 0) {
                addinline(form, {id: 'custpage_bill_charge', label: 'NCHL Charge', type: serverWidget.FieldType.CURRENCY, container: 'bill'})
                    .defaultValue = round(bill.chargeAmount)
            }
            if (problems.length > 0) {
                showmessage(form, message.Type.ERROR, 'Cannot pay this bill', problems.join('<br>') + '<br>Nothing was paid.')
                return form
            }
            const debtor = payment.debtorBank
            const raw = {
                paymenttype: 'CIPS',
                amount: billAmount,
                purpose: gov.PURPOSE,
                drbank: JSON.parse(debtor.custrecord_rdnchl_bank_prop).value,
                drbankbranch: JSON.parse(debtor.custrecord_rdnchl_bank_branch_prop).value,
                draccountname: debtor.custrecord_rdnchl_account_name,
                draccount: debtor.custrecord_rdnchl_account_number,
                billertype: payment.billerKey,
                journalamount: payment.amount,
                npiobject: npi,
                // REVIEWED: nothing paid yet, so getactivenchltran does not block another try
                stage: 'REVIEWED'
            }
            const nchlTranId = rdmod.savenchltran({relrecord: JSON.stringify({type: journal.type, id: journal.id}), params: raw})
            // one bill per session
            sessioncache().remove({key: 'journal_' + journal.id})
            addhidden(form, 'custpage_journal', journal.id)
            addhidden(form, 'custpage_nchltran', nchlTranId)
            addhidden(form, 'custpage_step', 'confirm')
            showmessage(form, message.Type.CONFIRMATION, 'Step 2 of 2',
                'Check the bill and the paying bank, then click Make Payment to pay ' + payment.amount + '.')
            form.addSubmitButton({label: 'Make Payment'})
            return form
        }

        /**
         * Step 3: confirm (pay) the reviewed bill, once
         */
        function confirmbill(context, journal) {
            const request = context.request
            const form = serverWidget.createForm({title: TITLE})
            const nchlTranId = request.parameters.custpage_nchltran
            const tran = search.lookupFields({
                type: 'customrecord_nchl_transaction',
                id: nchlTranId,
                columns: ['custrecord_nchl_tran_rel_record', 'custrecord_nchl_tran_raw_detail']
            })
            const relRecord = tran.custrecord_nchl_tran_rel_record.length ? String(tran.custrecord_nchl_tran_rel_record[0].value) : ''
            const raw = JSON.parse(tran.custrecord_nchl_tran_raw_detail || '{}')
            if (relRecord !== String(journal.id) || raw.stage !== 'REVIEWED') {
                // already confirmed (or being confirmed): show it instead of paying twice
                redirect.toRecord({type: 'customrecord_nchl_transaction', id: nchlTranId})
                return null
            }
            const blockReason = getblockreason(journal)
            if (blockReason && blockReason.activeTran) {
                redirect.toRecord({type: 'customrecord_nchl_transaction', id: blockReason.activeTran.id})
                return null
            }
            if (blockReason) {
                showmessage(form, message.Type.WARNING, blockReason.title, blockReason.message)
                return form
            }
            const payment = getgovpayment(journal)
            const bill = raw.npiobject.cipsTransactionDetail || {}
            if (payment.problems.length > 0 || round(bill.amount) !== payment.amount || payment.billerKey !== raw.billertype) {
                adddetail(form, journal, payment)
                showmessage(form, message.Type.ERROR, 'Journal changed', 'The journal no longer matches the bill. Open Pay Online again.')
                return form
            }
            // set before the request: if the answer is lost, the payment stays blocked until someone checks it
            raw.stage = 'CONFIRMING'
            record.submitFields({
                type: 'customrecord_nchl_transaction',
                id: nchlTranId,
                values: {custrecord_nchl_tran_raw_detail: JSON.stringify(raw)}
            })
            let confirm
            try {
                confirm = rdmod.confirmbillerpay(nchlTranId)
            } catch (e) {
                // no answer: the result is unknown, so the record stays blocked (UNKNOWN) instead of being retried
                log.error('GOV_CONFIRM_ERROR', e)
                redirect.toRecord({type: 'customrecord_nchl_transaction', id: nchlTranId})
                return null
            }
            raw.stage = 'CONFIRMED'
            record.submitFields({
                type: 'customrecord_nchl_transaction',
                id: nchlTranId,
                values: {
                    custrecord_nchl_tran_response: JSON.stringify(confirm),
                    custrecord_nchl_tran_raw_detail: JSON.stringify(raw)
                }
            })
            redirect.toRecord({type: 'customrecord_nchl_transaction', id: nchlTranId})
            return null
        }

        return {
            onRequest: context => {
                let form
                try {
                    const params = context.request.parameters
                    const journal = record.load({type: record.Type.JOURNAL_ENTRY, id: params.custpage_journal || params.recordid})
                    if (context.request.method === 'GET') {
                        form = writebillerpage(context, journal)
                    } else if (params.custpage_step === 'confirm') {
                        form = confirmbill(context, journal)
                    } else {
                        form = reviewbill(context, journal)
                    }
                } catch (e) {
                    log.error('GOV_PAYMENT_ERROR', e)
                    form = serverWidget.createForm({title: TITLE})
                    showmessage(form, message.Type.ERROR, 'ERROR', e.message || JSON.stringify(e))
                }
                if (form) {
                    context.response.writePage({pageObject: form})
                }
            }
        }
    })
