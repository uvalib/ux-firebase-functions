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
      libraryOptions.from = req.fld_email_address;
      libraryOptions.replyTo = req.fld_email_address;
      // @TODO Routing varies based on format and if for reserves...
      libraryOptions.to = 'jlk4p@virginia.edu';
      libraryOptions.subject = 'Purchase Request';
      libraryOptions.text = 'This is where the fields and their values would be displayed...';

      patronOptions.to = req.fld_email_address;
      patronOptions.subject = 'Purchase Request';
      patronOptions.text = 'This is where the fields and their values would be displayed...';

      // @TODO Process input in preparation for posting to Springshare LibInsight
      break;
    case 'government_information_contact_u':
      let inputs = '';
      if (req.fld_uva_computing_id) {
        inputs += "UVA Computing ID, e.g. mst3k: " + req.fld_uva_computing_id.value + "\n";
      }
      inputs += "Name: " + req.fld_name.value + "\n";
      inputs += "Email address: " + req.fld_email_address + "\n";
      inputs += "Question or Comment\n" + req.fldset_question_or_comment.fld_enter_your_question_or_comment_regarding_governement_resourc.value + "\n";

      libraryOptions.from = req.fld_email_address;
      libraryOptions.replyTo = req.fld_email_address;
      // @TODO Routing goes to Govtinfo address in production.
      libraryOptions.to = 'jlk4p@virginia.edu';
      libraryOptions.subject = 'Reference Referral';
      libraryOptions.text = "The question below was submitted through the Government Information Resources Contact Us page:\n\n";
      libraryOptions.text += inputs;

      patronOptions.from = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
      patronOptions.replyTo = '"U.Va. Library: Govt. Info. Svcs." <govtinfo@groups.mail.virginia.edu>';
      patronOptions.to = req.fld_email_address;
      patronOptions.subject = 'Your reference referral';
      patronOptions.text = "Your request has been received and will be referred to Government Information Resources.\n\n";
      patronOptions.text += inputs;
      // @TODO Process input in preparation for posting to Springshare LibInsight
      break;
    case '':
      break;
    default:
      break;
  }

  // Route request to appropriate Library resources.
  return mailTransport.sendEmail(libraryOptions, (error, info) => {
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
  });

});
