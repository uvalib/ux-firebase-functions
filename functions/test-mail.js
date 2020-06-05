const fetch = require('node-fetch');
const emailUrl = 'https://api.library.virginia.edu/mailer/mailer.js';
const headerObj = {'Content-Type': 'application/x-www-form-urlencoded'};
let queryString = '';

let mailMsg1 = {
from: '"Jack Kelly" <jlk4p@virginia.edu>',
replyTo: 'jlk4p@virginia.edu',
to: 'jkelly@virginia.edu',
bcc: '',
subject: 'Non-rush: Purchase Recommendation to Acquisitions',
text: 'Fund code: UL-REQUESTS\nLibrary location: LC CLASS\nFormat: eBook\nType of request: Not needed immediately\nBibliographic Information\nTitle: Testing this after making sure data us url encoded\nAuthor/Editor: T Jefferson\nPublisher: UVA Library\nDate of publication: 2022\nAdditional comments: Yet again testing to see if this works.\nSuggested by\nName: Jack Kelly\nEmail address: jlk4p@virginia.edu\nUVA computing ID: jlk4p\nPhone number: +1 (434) 924-7119\nUniversity affiliation: Staff\nUniversity department or school: Other...\nOther department or school: library\nreq #: 05b82e03-3dfe-4031-ae5d-4bb6ec300a01',
html: '<strong>Fund code:</strong> UL-REQUESTS<br>\n<strong>Library location:</strong> LC CLASS<br>\n<strong>Format:</strong> eBook<br>\n<strong>Type of request:</strong> Not needed immediately<br>\n\n<h3>Bibliographic Information</h3>\n\n<p><strong>Title:</strong> Testing this after making sure data us url encoded<br>\n<strong>Author/Editor:</strong> T Jefferson<br>\n<strong>Publisher:</strong> UVA Library<br>\n<strong>Date of publication:</strong> 2022<br>\n<strong>Additional comments:</strong> Yet again testing to see if this works.<br>\n\n<h3>Suggested by</h3>\n\n<p><strong>Name:</strong> Jack Kelly<br>\n<strong>Email address:</strong> jlk4p@virginia.edu<br>\n<strong>UVA computing ID:</strong> jlk4p<br>\n<strong>Phone number:</strong> +1 (434) 924-7119<br>\n<strong>University affiliation:</strong> Staff<br>\n<strong>University department or school:</strong> Other...<br>\n<strong>Other department or school:</strong> library<br>\n<br>\n<br>\n<br>\n<strong>req #: </strong>05b82e03-3dfe-4031-ae5d-4bb6ec300a01',
attach_type: 'attach',
sourceFile: '',
destFile: '' };

let mailMsg2 = { secret: 'compub123',
from: '"UVA Library" <no-reply-library@Virginia.EDU>',
replyTo: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
to: 'jlk4p@virginia.edu',
bcc: '',
subject: 'Your Purchase Recommendation',
text: 'Fund code: UL-REQUESTS\nLibrary location: LC CLASS\nFormat: eBook\nType of request: Not needed immediately\nBibliographic Information\nTitle: Testing this after making sure data us url encoded\nAuthor/Editor: T Jefferson\nPublisher: UVA Library\nDate of publication: 2022\nAdditional comments: Yet again testing to see if this works.\nSuggested by\nName: Jack Kelly\nEmail address: jlk4p@virginia.edu\nUVA computing ID: jlk4p\nPhone number: +1 (434) 924-7119\nUniversity affiliation: Staff\nUniversity department or school: Other...\nOther department or school: library\nreq #: 05b82e03-3dfe-4031-ae5d-4bb6ec300a01',
html: '<strong>Fund code:</strong> UL-REQUESTS<br>\n<strong>Library location:</strong> LC CLASS<br>\n<strong>Format:</strong> eBook<br>\n<strong>Type of request:</strong> Not needed immediately<br>\n\n<h3>Bibliographic Information</h3>\n\n<p><strong>Title:</strong> Testing this after making sure data us url encoded<br>\n<strong>Author/Editor:</strong> T Jefferson<br>\n<strong>Publisher:</strong> UVA Library<br>\n<strong>Date of publication:</strong> 2022<br>\n<strong>Additional comments:</strong> Yet again testing to see if this works.<br>\n\n<h3>Suggested by</h3>\n\n<p><strong>Name:</strong> Jack Kelly<br>\n<strong>Email address:</strong> jlk4p@virginia.edu<br>\n<strong>UVA computing ID:</strong> jlk4p<br>\n<strong>Phone number:</strong> +1 (434) 924-7119<br>\n<strong>University affiliation:</strong> Staff<br>\n<strong>University department or school:</strong> Other...<br>\n<strong>Other department or school:</strong> library<br>\n<br>\n<br>\n<br>\n<strong>req #: </strong>05b82e03-3dfe-4031-ae5d-4bb6ec300a01',
attach_type: 'attach',
sourceFile: '',
destFile: '' };

function paramsString(obj) {
  return Object.keys(obj).map(key => key + '=' + encodeURIComponent(obj[key])).join('&');
}

function postEmailAndData(reqId, requestEmailOptions, confirmEmailOptions) {
  console.log('entered postEmailAndData function');
  queryString = paramsString(requestEmailOptions);
  fetch(emailUrl, { method: 'POST', body: queryString, headers: headerObj })
  .then(res => res.text())
  .then(body => {
      console.log('library request email sent to emailUrl');
      if (body && (body.search('Status: 201 Created') !== -1)) {
          console.log(`Library request notification sent for ${reqId}: `+body);
          queryString = paramsString(confirmEmailOptions);
          return fetch(emailUrl, { method: 'POST', body: queryString, headers: headerObj });
      } else {
          console.log(`Library request notification failed for ${reqId}: `+body);
          throw new Error(`Library request notification failed for ${reqId}: `+body);
      }
  })
  .then(res => res.text())
  .then(body => {
      console.log('library confirm email sent to emailUrl');
      if(body && (body.search('Status: 201 Created') !== -1)) {
          console.log(`Patron confirmation notification sent for ${reqId}: `+body);
          queryString = paramsString(formData);
          return fetch(apiUrl, { method: 'POST', body: queryString, headers: headerObj });
      } else {
          console.log(`Patron confirmation notification failed for ${reqId}: `+body);
          throw new Error(`Patron confirmation notification failed for ${reqId}: `+body);
      }
  })
  .catch(error => function(error) {
      console.log(`Error for request ${reqId}: `);
      console.log(error);
      return error;
  });
}

postEmailAndData('test-1234-abcd-ef78',mailMsg1,mailMsg2);
