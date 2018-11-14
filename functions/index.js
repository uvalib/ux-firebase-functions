const functions = require('firebase-functions');
const nodemailer = require('nodemailer');
const request = require('request');
const stripHtml = require('string-strip-html');

// Environment variables configured for use with sending emails for forms.
// See https://firebase.google.com/docs/functions/config-env
const gmailEmail = functions.config().gmail.formsemail;
const gmailPassword = functions.config().gmail.formspassword;

// Configure the email transport using the default SMTP transport and a GMail account.
// For other types of transports such as Sendgrid see https://nodemailer.com/transports/
const mailTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: gmailEmail,
        pass: gmailPassword,
    },
});

// Process each form request that gets submitted.
exports.processRequest = functions.database.ref('/requests/{requestId}').onCreate((snapshot, context) => {
    // Document the request id for possible use in logging errors.
    const requestId = context.params.requestId;
    // Grab the request.
    const newRequest = snapshot.val();
    const reqDetails = JSON.parse(newRequest.submission);
    const formId = getFormId(reqDetails);
    const when = new Date(newRequest.timestamp);
    //console.log(newRequest);
    console.log(`details: ${JSON.stringify(reqDetails)}`);
    console.log(`form_id: ${formId}`);
    console.log(`when: ${when.toString()}`);

    // @TODO Validation of required inputs should be client side only
    // @TODO Just thinking... submit click in the form should make sure all required fields have been populated at least!

    // Initialize email routing/content.
    let libraryOptions = {
        from: '',
        replyTo: '',
        to: '',
        subject: '',
        text: '',
        html: ''
    };
    let patronOptions = {
        from: '"UVA Library" <no-reply-library@Virginia.EDU>',
        replyTo: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
        to: '',
        subject: '',
        text: '',
        html: ''
    };

    //    return mailTransport.sendMail(patronOptions)
    //        .then(() => console.log(`Sent email regarding request ${requestId}`))
    //        .catch((error) => console.error('There was an error while sending the email:', error));

    // Identify the request type and process...
    const formFields = getFormFields(reqDetails);
    if (formId === 'purchase_requests') {
        console.log(`purchase request: ${requestId}`);
        return processPurchaseRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'government_information_contact_u') {
        console.log(`gov docs request: ${requestId}`);
        return processGovernmentInformationRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else {
        return null;
    }

});

function getFormId(formDefn) {
    let i = 0;
    let form_id = '';
    while (i < formDefn.length) {
        if (formDefn[i].webform && formDefn[i].webform !== '') {
            form_id = formDefn[i].webform;
            break;
        }
        i++;
    }
    return form_id;
}

function getFormFields(formDefn) {
    let i = 0;
    let fields = {};
    while (i < formDefn.length) {
        let field = formDefn[i].webform_key;
        //console.log(`field: ${field}`);
        if (field.match(/^sect_/)) {
            fields[field] = { title: formDefn[i].title, fields: getSectionFields(formDefn[i]) };
        } else if (field.match(/^fld_|authenticated/)) {
            fields[field] = { label: formDefn[i].title, value: formDefn[i].value };
        } else if (field.match(/^fldset_/)) {
            // @TODO need to flesh this out some depending on ways might use this down the road...
        }
        i++;
    }
    return fields;
}

function getSectionFields(section) {
    let fields = {};
    for (var key in section) {
        if (key.match(/^fld_/)) {
            fields[key] = { label: section[key].title, value: section[key].value };
        }
        // @TODO address fieldset down the road?
    }
    return fields;
}

function processPurchaseRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let inputs = msg = '';
    let data = {};

    // Prepare email content for Library staff and LibInsight data parameters
    libOptions.from = frmData.fldset_requestor_information.fld_email_address.value;
    libOptions.replyTo = frmData.fldset_requestor_information.fld_email_address.value;
    // @TODO Routing varies based on format and if for reserves...
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Purchase Request';
    libOptions.text = 'This is where the fields and their values would be displayed...';
    request['libEmailOptions'] = libOptions;
    // Prepare email confirmation content for patron
    userOptions.to = frmData.fldset_requestor_information.fld_email_address.value;
    userOptions.subject = 'Purchase Request';
    userOptions.text = 'This is where the fields and their values would be displayed...';
    request['patronEmailOptions'] = userOptions;
    // @TODO Process input in preparation for posting to Springshare LibInsight

}

function processGovernmentInformationRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let inputs = msg = '';
    let data = { 'field_619': reqId, 'ts_start': submitted };
    let promises = [];
    let results = {};

    console.log(`frmData: ${JSON.stringify(frmData)}`);
    // Prepare email message body and LibInsight data parameters
    if (frmData.fld_name.value) {
        inputs += "<strong>" + frmData.fld_name.label + ":</strong> " + frmData.fld_name.value + "<br>\n";
        data['field_623'] = frmData.fld_name.value;
    }
    if (frmData.fld_email_address.value) {
        inputs += "<strong>" + frmData.fld_email_address.label + ":</strong> " + frmData.fld_email_address.value + "<br>\n";
        data['field_624'] = frmData.fld_email_address.value;
    }
    if (frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value) {
        inputs += "<h2>" + frmData.sect_question_or_comment.title + "</h2>\n\n<p>" + frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value + "</p><br>\n";
        data['field_625'] = frmData.sect_question_or_comment.fields.fld_enter_your_question_or_comment_regarding_governement_resourc.value;
    }
    msg = "<p>The question below was submitted through the Government Information Resources Contact Us page:</p><br>\n\n";

    // Prepare email content for Library staff
    // @TODO Routing goes to Govtinfo address in production: govtinfo@groups.mail.virginia.edu
    libOptions.from = frmData.fld_email_address.value;
    libOptions.replyTo = frmData.fld_email_address.value;
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Reference Referral';
    libOptions.html = msg + inputs;
    libOptions.text = stripHtml(msg + inputs);
    promises[0] = mailTransport.sendMail(libOptions);

    // Prepare email confirmation content for patron
    msg = "<p>Your request (copied below) has been received and will be referred to Government Information Resources.</p><br>\n\n";
    userOptions.from = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.replyTo = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.to = frmData.fld_email_address.value;
    userOptions.subject = 'Your reference referral';
    userOptions.html = msg + inputs;
    userOptions.text = stripHtml(msg + inputs);
    promises[1] = mailTransport.sendMail(userOptions);

    // Post to LibInsight
    promises[2] = request.post({
        url: 'https://virginia.libinsight.com/add.php?wid=7&type=5&token=bb329274df6e4be51624cfe7f955b7eb',
        form: data
    });

    console.log(`promises: ${promises}`);

    return Promise.all(promises)
        .then(responses => {
            let errors = false;
            if (responses[0].err) {
                errors = true;
                console.log(`Request ${reqId} library notification failed: ${responses['library_notification'].err.toString()}`);
            } else {
                results.library_notification = 'succeeded';
            }
            if (responses[1].err) {
                errors = true;
                console.log(`Request ${reqId} patron notification failed: ${responses['patron_notification'].err.toString()}`);
            } else {
                results.patron_notification = 'succeeded';
            }
            if (!responses[2].response) {
                errors = true;
                console.log(`Request ${reqId} LibInsight POST failed.`);
            } else {
                results.LibInsight = 'succeeded';
            }
            if (errors) {
                return errors;
            } else {
                console.log(`results: ${JSON.stringify(results)}`);
                return results;
            }
        })
        .catch(error => {
            // empty results would be adequate to indicate an error
            console.log(`error: ${JSON.stringify(error)}`);
            return error;
        });
}