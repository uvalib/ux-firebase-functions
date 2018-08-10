const functions = require('firebase-functions');
const nodemailer = require('nodemailer');

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
    // Grab the request.
    let req = JSON.parse(snapshot.submission.val());
    let when = snapshot.timestamp.val();
    let results = Array();
    console.log('req: ' + req);
    console.log('when: ' + when);

    // @TODO Validation of required inputs before we consider anything and redirect back to form???
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
        from: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
        replyTo: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
        to: req.fld_email_address,
        subject: '',
        text: '',
        html: ''
    };

    // Identify the request type and process...
    switch (req.form_id) {
        case 'purchase_requests':
            results = prepPurchaseRequestInfo(req, libraryOptions, patronOptions);
            break;
        case 'government_information_contact_u':
            results = prepGovernmentInformationRequest(req, libraryOptions, patronOptions);
            break;
        default:
            results = [];
            break;
    }

    // If a valid form then send notifications and save data to LibInsight.
    if (results.length > 0) {
        // If the form submission is valid then continue...
        if (results['valid']) {
            const tasks = [];
            tasks.push(mailTransport.sendEmail(results['libEmailOptions']));
            tasks.push(mailTransport.sendEmail(results['patronEmailOptions']));
            tasks.push(saveToLibInsight['']);
            return Promise.all(tasks);
        } else {
            // return a Promis error?
            return Promise.error()
        }
    } else {
        return Promise.error()
    }

    // Route request to appropriate Library resources.
    //return mailTransport.sendEmail(libraryOptions)
    //    .then(() => console.log('Message successfully sent.'))
    //    .catch((error) => console.log('Error processing Library routing for request ' + requestId));

    // Route request to appropriate Library resources.
    /*  return mailTransport.sendEmail(libraryOptions, (error, info) => {
        if (error) {
          console.log('Error processing Library routing for request ' + requestId);
        }
        // Sends an email confirmation to the requestor.
        return mailTransport.sendEmail(patronOptions, (error, info) => {
          if (error) {
            console.log('Error processing patron routing for request ' + requestId);
          }
          // @TODO Writes a copy of the request to Springshare.

          // If an authenticated user, then update the status of the issue in the requestor's queue.
          if (req.authenticated) {
            let update = {};
            update['/users/'+uid+'/requests/'+requestId+'/status'] = 'Received';
            return firebase.database().ref().update(update);
          }

        });
      });*/

});

function prepPurchaseRequestInfo(frmData, libOptions, userOptions) {
    let inputs = '',
        request = Array();
    request['valid'] = false;

    request['valid'] = true; // set after inputs validated and email body constructed

    // Prepare email content for Library staff
    libOptions.from = req.fld_email_address;
    libOptions.replyTo = req.fld_email_address;
    // @TODO Routing varies based on format and if for reserves...
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Purchase Request';
    libOptions.text = 'This is where the fields and their values would be displayed...';
    request['libEmailOptions'] = libOptions;
    // Prepare email confirmation content for patron
    userOptions.to = req.fld_email_address;
    userOptions.subject = 'Purchase Request';
    userOptions.text = 'This is where the fields and their values would be displayed...';
    request['patronEmailOptions'] = userOptions;
    // @TODO Process input in preparation for posting to Springshare LibInsight

    return request;
}

function prepGovernmentInformationRequest(frmData, libOptions, userOptions) {
    let inputs = '',
        request = Array();
    request['valid'] = false;

    // Prepare email message body.
    if (req.fld_uva_computing_id) {
        inputs += "UVA Computing ID, e.g. mst3k: " + req.fld_uva_computing_id.value + "\n";
    }
    if (req.fld_name.value && req.fld_email_address.value && req.fldset_question_or_comment.fld_enter_your_question_or_comment_regarding_governement_resourc.value) {
        request['valid'] = true;
        inputs += "Name: " + req.fld_name.value + "\n";
        inputs += "Email address: " + req.fld_email_address.value + "\n";
        inputs += "Question or Comment\n" + req.fldset_question_or_comment.fld_enter_your_question_or_comment_regarding_governement_resourc.value + "\n";
    }

    // Prepare email content for Library staff
    // @TODO Routing goes to Govtinfo address in production: govtinfo@groups.mail.virginia.edu
    libOptions.from = req.fld_email_address.value;
    libOptions.replyTo = req.fld_email_address.value;
    libOptions.to = 'jlk4p@virginia.edu';
    libOptions.subject = 'Reference Referral';
    libOptions.text = "The question below was submitted through the Government Information Resources Contact Us page:\n\n";
    libOptions.text += inputs;
    request['libEmailOptions'] = libOptions;
    // Prepare email confirmation content for patron
    userOptions.from = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.replyTo = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
    userOptions.to = req.fld_email_address.value;
    userOptions.subject = 'Your reference referral';
    userOptions.text = "Your request (copied below) has been received and will be referred to Government Information Resources.\n\n";
    userOptions.text += inputs;
    request['patronEmailOptions'] = userOptions;
    // @TODO Process input in preparation for posting to Springshare LibInsight

    return request;
}