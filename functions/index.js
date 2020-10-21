const functions = require('firebase-functions');
const admin = require('firebase-admin');
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
const bucket = storage.bucket('uvalib-api.appspot.com');
const nodeFetch = require('node-fetch');
const stripHtml = require('string-strip-html');
const moment = require('moment');
const { ref } = require('firebase-functions/lib/providers/database');
const { ResultStorage } = require('firebase-functions/lib/providers/testLab');
const headerObj = {'Content-Type': 'application/x-www-form-urlencoded'};
// Form file upload location
const PREFIX_FILE_UPLOAD = 'form_file_uploads/';
// Over 30 days old. Requests older than this will be deleted.
const OVER_30_DAYS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds.
// Over 6 months old. Requests older than this will be deleted.
const OVER_6_MONTHS = 6 * 30 * 24 * 60 * 60 * 1000; // 6 months in milliseconds.

// Environment variables configured for use with sending emails and saving data to LibInsight for forms.
// See https://firebase.google.com/docs/functions/config-env
const emailSecret = functions.config().email.secret;
const emailUrl = 'https://api.library.virginia.edu/mailer/mailer.js';
const purchaseRecommendationDatasetApi = functions.config().libinsighturl.purchaserecommendation;
const staffPurchaseRequestDatasetApi = functions.config().libinsighturl.staffpurchaserequest;
const internalRoomRequestDatasetApi = functions.config().libinsighturl.internalroomrequest;
const specCollInstructionDatasetApi = functions.config().libinsighturl.speccollinstruction;
const personalCopyReserveDatasetApi = functions.config().libinsighturl.personalcopyreserve;
const researchTutorialRequestDatasetApi = functions.config().libinsighturl.researchtutorial;
const requestLibraryClassDatasetApi = functions.config().libinsighturl.libraryclass;
const requestEventSpaceDatasetApi = functions.config().libinsighturl.eventspacerequest;
const requestVideoClipsDatasetApi = functions.config().libinsighturl.videocliprequest;
const requestMediaClassroomDatasetApi = functions.config().libinsighturl.mediaclassroomrequest;
const requestZoomRoomDatasetApi = functions.config().libinsighturl.zoomroomrequest;
const requestInternalZoomWebinarDatasetApi = functions.config().libinsighturl.internalzoomwebinarrequest;
const governmentInformationDatasetApi = functions.config().libinsighturl.governmentinformation;

// Variables for identifying a problem when a form submission doesn't complete successfully in sending emails or saving data to LibInsight.
let queryString = '';

// Each time requests are added, check for requests over 30 days old and delete them.
/* exports.deleteOldRequests = functions.database.ref('/requests/{requestId}').onWrite(async (change) => {
    console.log('Deleting request over 6 months old...');
    const reqs = change.after.ref.parent; // reference to the requests path
    const now = Date.now();
    const cutoff = now - OVER_6_MONTHS;
    const oldReqsQuery = reqs.where('timestamp', '<', cutoff).orderByChild('timestamp').limit(100);
    const snapshot = await oldReqsQuery.once('value');
    // create a map with all children that need to be removed
    const updates = {};
    snapshot.forEach(child => {
      updates[child.key] = null;
    });
    // execute all updates in one go and return the result to end the function
    return ref.update(updates);
});*/

// Clean up form request file uploads once a day.
exports.fileUploadCleanup = functions.pubsub.schedule('every day 14:05').timeZone('America/New_York').onRun(async context => {
    console.log('File upload cleanup runs daily at ????am.');
    const now = Date.now();
    const over6MonthsOld = now - OVER_6_MONTHS;
    var filenames = await getFilesUploaded();
    console.log(filenames.length);
/*    filenames.forEach(filename => {
        console.log(filename);
        var timeCreated = getFileTimeCreated(filename);
    });*/
});

async function getFileTimeCreated(filename) {
    const file = bucket.file(filename);
    var time = await file.getMetadata().then(metadata => {
        // metadata value is undefined. Log also indicates this runs asynchronously causing issue
        console.log('timeCreated: '+metadata.timeCreated);
        return 'getFileTimeCreated return value';
    })
    .catch(error => {
        console.log(error);
    });
    return time;
}

async function getFilesUploaded() {
    const options = { prefix: PREFIX_FILE_UPLOAD };
    const [dirContent] = await bucket.getFiles(options);
    var files = [];
    dirContent.forEach(file => {
        if (file.name !== PREFIX_FILE_UPLOAD) {
            files.push(file.name);
        }
    });
    return files;
}






admin.initializeApp({databaseURL: "https://uvalib-api-occupancy.firebaseio.com"});
exports.libraryOccupancyLogging = functions.database.instance('uvalib-api-occupancy')
    .ref('/locations-schemaorg/location/{libraryId}/occupancy')
    .onUpdate((change, context) => {
      const userId = (context.auth && context.auth.uid)? context.auth.uid:"";
      const libraryId = context.params.libraryId;
      const entry = change.after.val();
      admin.database().ref(`locationsLogs/${libraryId}/occupancylogs/${entry.timestamp_end}`)
          .set({value:entry.value, userId:userId});
    });
exports.libraryNoMaskCountLogging = functions.database.instance('uvalib-api-occupancy')
    .ref('/locations-schemaorg/location/{libraryId}/noMaskCount')
    .onUpdate((change, context) => {
      const userId = (context.auth && context.auth.uid)? context.auth.uid:"";
      const libraryId = context.params.libraryId;
      const entry = change.after.val();
      admin.database().ref(`locationsLogs/${libraryId}/noMaskCountlogs/${entry.timestamp_end}`)
          .set({value:entry.value, userId:userId});
    });
exports.occupancyLogging = functions.database.instance('uvalib-api-occupancy')
    .ref('/locations-schemaorg/location/{libraryId}/containedInPlace/{locationId}/occupancy')
    .onUpdate((change, context) => {
      const userId = (context.auth && context.auth.uid)? context.auth.uid:"";
      const libraryId = context.params.libraryId;
      const locationId = context.params.locationId;
      const entry = change.after.val();
      admin.database().ref(`/locationsLogs/${libraryId}/${locationId}/occupancylogs/${entry.timestamp}`)
          .set({value:entry.value, userId:userId});
    });
exports.noMaskCountLogging = functions.database.instance('uvalib-api-occupancy')
    .ref('/locations-schemaorg/location/{libraryId}/containedInPlace/{locationId}/noMaskCount')
    .onUpdate((change, context) => {
      const userId = (context.auth && context.auth.uid)? context.auth.uid:"";
      const libraryId = context.params.libraryId;
      const locationId = context.params.locationId;
      const entry = change.after.val();
      admin.database().ref(`/locationsLogs/${libraryId}/${locationId}/noMaskCountlogs/${entry.timestamp}`)
          .set({value:entry.value, userId:userId});
    });
/* User Roles */
exports.roleCreate = functions.database.instance('uvalib-api-occupancy').ref('/roles/{userId}')
.onCreate((snapshot, context) => {
    const userId = context.params.userId;
    var role = {}
    const roles = snapshot.val();
    roles.forEach(r=>{role[r]=true})
//          console.log(role)
    return admin.auth().setCustomUserClaims(userId, role);
});
exports.roleUpdate = functions.database.instance('uvalib-api-occupancy').ref('/roles/{userId}')
.onUpdate((snapshot, context) => {
  const userId = context.params.userId;
  var role = {}
  const roles = snapshot.after.val();
  roles.forEach(r=>{role[r]=true})
//        console.log(role)
  return admin.auth().setCustomUserClaims(userId, role);
});
exports.roleDelete = functions.database.instance('uvalib-api-occupancy').ref('/roles/{userId}')
.onDelete((snapshot, context) => {
  const userId = context.params.userId;
  return admin.auth().setCustomUserClaims(userId, null);
});
/* end User Roles */





// Process each form request that gets submitted.
exports.processRequest = functions.database.ref('/requests/{requestId}').onCreate((snapshot, context) => {
    // Document the request id for possible use in logging errors.
    const requestId = context.params.requestId;
    // Grab the request.
    const newRequest = snapshot.val();
    const reqDetails = JSON.parse(newRequest.submission);
    const formId = getFormId(reqDetails);
    const when = new Date(newRequest.timestamp);
    console.log(`newRequest: ${newRequest.submission}`);

    // Initialize email routing/content.
    let libraryOptions = {
        secret: emailSecret,
        from: '"UVA Library" <no-reply-library@Virginia.EDU>',
        replyTo: '',
        to: '',
        bcc: '',
        subject: '',
        text: '',
        html: '',
        attach_type: 'attach',
        sourceFile: '',
        destFile: '',
        attach_type1: 'attach',
        sourceFile1: '',
        destFile1: ''
    };
    let patronOptions = {
        secret: emailSecret,
        from: '"UVA Library" <no-reply-library@Virginia.EDU>',
        replyTo: '"UVA Library" <NO-REPLY-LIBRARY@Virginia.EDU>',
        to: '',
        bcc: '',
        subject: '',
        text: '',
        html: '',
        attach_type: 'attach',
        sourceFile: '',
        destFile: '',
        attach_type1: 'attach',
        sourceFile1: '',
        destFile1: ''
    };

    // Identify the request type and process...
    const formFields = getFormFields(reqDetails);
    console.log(`${formId}: ${requestId}`);
    if ((formId === 'purchase_requests') || (formId === 'purchase_request_limited_functio')) {
        return processPurchaseRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'request_a_library_class') {
        return processLibraryClassRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if ((formId === 'class_visits_and_instruction') || (formId === 'class_visits_and_instruction_v2')) {
        return processSpecCollInstructionRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'personal_copy_reserve') {
        return processPersonalCopyReserveRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'research_tutorial_request') {
        return processResearchTutorialRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'staff_purchase_request') {
        return processStaffPurchaseRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'internal_room_request') {
        return processInternalRoomRequest(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'report_library_incident') {
        return processReportLibraryIncident(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'request_events_space') {
        return processRequestEventSpace(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'zoom_room_request') {
        return processRequestZoomRoom(requestId, when, formFields, libraryOptions, patronOptions);
    } else if (formId === 'zoom_webinar_request') {
        return processRequestZoomWebinar(requestId, when, formFields, libraryOptions, patronOptions);
    } else {
        return null;
    }

});

function dateTimeToString(dateTime) {
    let str = '';
    if (dateTime.date !== "") {
        str += convDateYMDtoMDY(dateTime.date);
        if (dateTime.startTime !== "") {
            str +=  " " + convTime24to12(dateTime.startTime);
        }
        if (dateTime.endTime !== "") {
            str += " " + convTime24to12(dateTime.endTime);
        }
    }
    return str;
}

function choiceDateTimeToString(choice) {
    let str = '';
    if (choice.preferredDateTime.date !== "") {
        str += "<p><strong>Choice " + choice.nth + "</strong><br>\n";
        str += "Date: " + convDateYMDtoMDY(choice.preferredDateTime.date) + "<br>\n";
        if (choice.preferredDateTime.startTime !== "") {
            str += "Begin time: " + convTime24to12(choice.preferredDateTime.startTime) + "<br>\n";
        }
        if (choice.preferredDateTime.endTime !== "") {
            str += "End time: " + convTime24to12(choice.preferredDateTime.endTime) + "<br>\n";
        }
        str += "</p>\n";
    }
    return str;
}

function convDateYMDtoMDY(date) {
    return moment(date,"YYYY-MM-DD").format("MM-DD-YYYY");
}

function convTime24to12(time) {
    let date = moment().format("YYYY-MM-DD ");
    return moment(date+time,"YYYY-MM-DD HH:mm").format("hh:mm A");
}

async function deleteFirebaseFile(sourceFile) {
    let file = bucket.file(PREFIX_FILE_UPLOAD + sourceFile);
    return await file.delete((error,response) => {
        if (error) {
            console.log(`Error deleting storage of ${sourceFile}: `+error.toString());
            return false;
        } else {
            console.log(`File ${sourceFile} deleted: `+response.toString());
            return true;
        }
    });
}

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
        if (field.match(/^sect_/)) {
            fields[field] = { title: formDefn[i].title, fields: getSectionFields(formDefn[i]) };
        } else if (field.match(/^fld_|mkup_|authenticated/)) {
            fields[field] = { label: formDefn[i].title, value: formDefn[i].value };
            if (formDefn[i].type === 'file' && formDefn[i].email_type) {
                fields[field].email_type = formDefn[i].email_type;
            } else if (formDefn[i].type === 'webform_markup') {
                fields[field].markup = formDefn[i].markup;
            }
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
        if (key.match(/^fld_|mkup_/)) {
            fields[key] = { label: section[key].title, value: section[key].value };
            if (section[key].type === 'file' && section[key].email_type) {
                fields[key].email_type = section[key].email_type;
            } else if (section[key].type === 'webform_markup') {
                fields[key].markup = section[key].markup;
            }
        }
        // @TODO address fieldset down the road?
    }
    return fields;
}

function isObjectEmpty(obj) {
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) return false;
    }
    return true;
}

async function processPurchaseRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let adminMsg = subjPre = courseInfo = biblioInfo = requestorInfo = '';
    let patronMsg = "<p>A copy of your purchase recommendation is shown below.</p><br>\n\n";
    let data = { 'field_642': reqId, 'ts_start': submitted };

    // Prepare email message body and LibInsight data parameters
    // The admin message has a few fields out of order placed at the top.
    // Fund Code and library location are internal fields defined for use in routing to Acquisitions and Collections Mgmt.
    // Fund code value depends on if the item is for reserve and what format the item is.
    // Library location depends on if the item is for reserve and which library location was specified.
    // Since fund code and library location are for admin purposes, they will not get saved to LibInsight data.
    let msg = fundCode = libraryLocation = "";
    if (frmData.fld_is_this_for_course_reserves_.value) {
        if (frmData.fld_is_this_for_course_reserves_.value === "Yes") {
            if ((frmData.fld_format.value === "Book") || (frmData.fld_format.value === "eBook") || (frmData.fld_format.value === "Dissertation or Thesis") || (frmData.fld_format.value === "Music Recording")) {
                fundCode = "UL-RESERVES";
                libraryLocation = "LC CLASS"; // library where typical call number gets housed
            }
        } else {
            if ((frmData.fld_format.value === "Book") || (frmData.fld_format.value === "eBook") || (frmData.fld_format.value === "Music Recording") || (frmData.fld_format.value === "Music Score")) {
                fundCode = "UL-REQUESTS";
                libraryLocation = (frmData.fld_format.value !== "Music Recording") ? "LC CLASS" : "Music";
            }
            libraryLocation = (frmData.fld_format.value !== "Music Recording") ? "LC CLASS" : "Music";
        }
    }
    libraryLocation = (frmData.fld_format.value === "Music Score") ? "Music" : libraryLocation;
    adminMsg += "<strong>Fund code:</strong> " + fundCode + "<br>\n";
    adminMsg += "<strong>Library location:</strong> " + libraryLocation + "<br>\n";
/*    if (frmData.fld_is_this_for_course_reserves_.value) {
        if (frmData.fld_is_this_for_course_reserves_.value === "Yes") {
            if (frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value) {
                adminMsg += "<strong>Library reserve hold location:</strong> " + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value + "<br>\n";
            }
            if (frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value) {
                adminMsg += "<strong>Library reserve loan period:</strong> " + frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value + "<br>\n";
            }
        }
    }*/

    if (frmData.fld_format.value) {
        msg = "<strong>" + frmData.fld_format.label + ":</strong> " + frmData.fld_format.value + "<br>\n";
        adminMsg += msg;
        patronMsg += msg;
        data['field_645'] = frmData.fld_format.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available_.value) {
        msg = "<strong>" + frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available_.label + ":</strong> ";
        msg += (frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available_.value === 1) ? 'Yes' : 'No';
        msg += "<br>\n";
        adminMsg += msg;
        patronMsg += msg;
        data['field_683'] = (frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available_.value === 1) ? 'Yes' : 'No';
    }
/*    if (frmData.sect_bibliographic_information.fields.fld_if_ebook_not_available_order_print_version.value) {
        msg = "<strong>" + frmData.sect_bibliographic_information.fields.fld_if_ebook_not_available_order_print_version.label + ":</strong> ";
        msg += (frmData.sect_bibliographic_information.fields.fld_if_ebook_not_available_order_print_version.value === 1) ? 'Yes' : 'No';
        msg += "<br>\n";
        adminMsg += msg;
        patronMsg += msg;
        data['field_793'] = (frmData.sect_bibliographic_information.fields.fld_if_ebook_not_available_order_print_version.value === 1) ? 'Yes' : 'No';
    }*/
    if (frmData.fld_which_type_of_request_is_this_.value) {
        // This type of request input is only appropriate to book/ebook format emails.
        if ((frmData.fld_format.value === 'Book') || (frmData.fld_format.value === 'eBook')) {
            msg = "<strong>Type of request:</strong> " + frmData.fld_which_type_of_request_is_this_.value + "<br>\n";
            adminMsg += msg;
            patronMsg += msg;
            // set the subject line prefix to the appropriate string
            subjPre = (frmData.fld_which_type_of_request_is_this_.value === 'Not needed immediately') ? 'Non-rush' : 'Rush';
        } else {
            subjPre = 'Non-rush';
        }
        data['field_646'] = frmData.fld_which_type_of_request_is_this_.value;
    } else {
        subjPre = 'Non-rush';
    }
    if (frmData.fld_is_this_for_course_reserves_.value) {
        if (frmData.fld_is_this_for_course_reserves_.value === "Yes") {
            adminMsg += "<strong>" + frmData.fld_is_this_for_course_reserves_.label + ":</strong> " + frmData.fld_is_this_for_course_reserves_.value + "<br>\n";
        }
        data['field_647'] = frmData.fld_is_this_for_course_reserves_.value;
        // Build course information output section and set appropriate LibInsight fields.
        if (frmData.fld_is_this_for_course_reserves_.value === "Yes") {
            courseInfo += "\n<h3>" + frmData.sect_course_information.title + "</h3>\n\n<p>";
/*            if (frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.label + ":</strong> " + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value + "<br>\n";
                data['field_655'] = frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value;
            }
            if (frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value) {
                courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.label + ":</strong> " + frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value + "<br>\n";
                data['field_708'] = frmData.sect_course_information.fields.fld_what_loan_period_should_be_applied_to_this_item_.value;
            }*/
            if (frmData.sect_course_information.fields.fld_course_section_selector.value) {
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.term) {
                    courseInfo += "<strong>Term:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.term + "<br>\n";
                    data['field_648'] = frmData.sect_course_information.fields.fld_course_section_selector.value.term;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.course) {
                    courseInfo += "<strong>Course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.course + "<br>\n";
                    data['field_649'] = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.section) {
                    courseInfo += "<strong>Section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.section + "<br>\n";
                    data['field_650'] = frmData.sect_course_information.fields.fld_course_section_selector.value.section;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse) {
                    courseInfo += "<strong>Alternate course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse + "<br>\n";
                    data['field_651'] = frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.altSection) {
                    courseInfo += "<strong>Alternate course section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.altSection + "<br>\n";
                    data['field_652'] = frmData.sect_course_information.fields.fld_course_section_selector.value.altSection;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.title) {
                    courseInfo += "<strong>Title:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.title + "<br>\n";
                    data['field_653'] = frmData.sect_course_information.fields.fld_course_section_selector.value.title;
                }
                if (frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment) {
                    courseInfo += "<strong>Enrollment:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment + "<br>\n";
                    data['field_654'] = frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment;
                }
            }
            courseInfo += "</p><br>\n";
        }
        // Create requestor info output content and set appropriate LibInsight fields.
        requestorInfo += "\n<h3>";
        requestorInfo += (frmData.fld_is_this_for_course_reserves_.value === "Yes") ? "Requested" : "Suggested";
        requestorInfo += " by</h3>\n\n<p>";
        if (frmData.sect_requestor_information.fields.fld_name.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_name.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_name.value + "<br>\n";
            data['field_687'] = frmData.sect_requestor_information.fields.fld_name.value;
        }
        if (frmData.sect_requestor_information.fields.fld_email_address.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_email_address.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_email_address.value + "<br>\n";
            data['field_688'] = frmData.sect_requestor_information.fields.fld_email_address.value;
        }
        if (frmData.sect_requestor_information.fields.fld_uva_computing_id.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_uva_computing_id.value + "<br>\n";
            data['field_686'] = frmData.sect_requestor_information.fields.fld_uva_computing_id.value;
        }
        if (frmData.sect_requestor_information.fields.fld_phone_number.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_phone_number.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_phone_number.value + "<br>\n";
            data['field_689'] = frmData.sect_requestor_information.fields.fld_phone_number.value;
        }
        if (frmData.sect_requestor_information.fields.fld_university_affiliation.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_affiliation.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_affiliation.value + "<br>\n";
            data['field_690'] = frmData.sect_requestor_information.fields.fld_university_affiliation.value;
        }
        if (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value) {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value + "<br>\n";
            data['field_691'] = frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value;
            if (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value === "Other...") {
                requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_other_lib_department_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_other_lib_department_school.value + "<br>\n";
                data['field_751'] = frmData.sect_requestor_information.fields.fld_other_lib_department_school.value;
            }
        }
        // The primary dept/school from LDAP is for internal use only within LibInsight. Not needed in email.
        if (frmData.sect_requestor_information.fields.fld_university_department_or_school.value) {
            //requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_department_or_school.value + "<br>\n";
            data['field_750'] = frmData.sect_requestor_information.fields.fld_university_department_or_school.value;
        }
        // Create format's bibliographic info output and set appropriate LibInsight fields.
        biblioInfo += "\n<h3>" + frmData.sect_bibliographic_information.title + "</h3>\n\n<p>";
        if (frmData.sect_bibliographic_information.fields.fld_isbn.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_isbn.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_isbn.value + "<br>\n";
            data['field_671'] = frmData.sect_bibliographic_information.fields.fld_isbn.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_title.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_title.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_title.value + "<br>\n";
            data['field_656'] = frmData.sect_bibliographic_information.fields.fld_title.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_name_title.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_name_title.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_name_title.value + "<br>\n";
            data['field_657'] = frmData.sect_bibliographic_information.fields.fld_name_title.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_author_editor.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_author_editor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_author_editor.value + "<br>\n";
            data['field_658'] = frmData.sect_bibliographic_information.fields.fld_author_editor.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_author.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_author.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_author.value + "<br>\n";
            data['field_659'] = frmData.sect_bibliographic_information.fields.fld_author.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_director.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_director.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_director.value + "<br>\n";
            data['field_660'] = frmData.sect_bibliographic_information.fields.fld_director.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.value + "<br>\n";
            data['field_661'] = frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_performer_s_.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_performer_s_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_performer_s_.value + "<br>\n";
            data['field_662'] = frmData.sect_bibliographic_information.fields.fld_performer_s_.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_composer_editor.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_composer_editor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_composer_editor.value + "<br>\n";
            data['field_663'] = frmData.sect_bibliographic_information.fields.fld_composer_editor.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_publisher.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_publisher.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_publisher.value + "<br>\n";
            data['field_664'] = frmData.sect_bibliographic_information.fields.fld_publisher.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.value + "<br>\n";
            data['field_665'] = frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_publisher_vendor.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_publisher_vendor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_publisher_vendor.value + "<br>\n";
            data['field_666'] = frmData.sect_bibliographic_information.fields.fld_publisher_vendor.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.value + "<br>\n";
            data['field_667'] = frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.value + "<br>\n";
            data['field_668'] = frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_record_label.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_record_label.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_record_label.value + "<br>\n";
            data['field_669'] = frmData.sect_bibliographic_information.fields.fld_record_label.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_date_of_publication.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_date_of_publication.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_date_of_publication.value + "<br>\n";
            data['field_670'] = frmData.sect_bibliographic_information.fields.fld_date_of_publication.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_release_date.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_release_date.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_release_date.value + "<br>\n";
            data['field_672'] = frmData.sect_bibliographic_information.fields.fld_release_date.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_year_of_publication.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_year_of_publication.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_year_of_publication.value + "<br>\n";
            data['field_673'] = frmData.sect_bibliographic_information.fields.fld_year_of_publication.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_production_date.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_production_date.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_production_date.value + "<br>\n";
            data['field_674'] = frmData.sect_bibliographic_information.fields.fld_production_date.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_edition.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_edition.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_edition.value + "<br>\n";
            data['field_675'] = frmData.sect_bibliographic_information.fields.fld_edition.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_edition_version.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_edition_version.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_edition_version.value + "<br>\n";
            data['field_676'] = frmData.sect_bibliographic_information.fields.fld_edition_version.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not_.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not_.value + "<br>\n";
            data['field_678'] = frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not_.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not_.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not_.value + "<br>\n";
            data['field_679'] = frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not_.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_and_or_students_might_use_this_res.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_and_or_students_might_use_this_res.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_and_or_students_might_use_this_res.value + "<br>\n";
            data['field_680'] = frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_and_or_students_might_use_this_res.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.value + "<br>\n";
            data['field_681'] = frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_price.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_price.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_price.value + "<br>\n";
            data['field_682'] = frmData.sect_bibliographic_information.fields.fld_price.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_additional_comments.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_additional_comments.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_additional_comments.value + "<br>\n";
            data['field_684'] = frmData.sect_bibliographic_information.fields.fld_additional_comments.value;
        }
        if (frmData.sect_bibliographic_information.fields.fld_description_comments.value) {
            biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_description_comments.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_description_comments.value + "<br>\n";
            data['field_685'] = frmData.sect_bibliographic_information.fields.fld_description_comments.value;
        }
    }

    // Prepare email content for Library staff
    libOptions.subject = subjPre + ': ';
    libOptions.subject += (frmData.fld_is_this_for_course_reserves_.value && (frmData.fld_is_this_for_course_reserves_.value === "Yes")) ? 'Reserve ' : '';
    libOptions.subject += 'Purchase Recommendation ';
    libOptions.from = '"' + frmData.sect_requestor_information.fields.fld_name.value + '" <' + frmData.sect_requestor_information.fields.fld_email_address.value + '>';
    libOptions.replyTo = frmData.sect_requestor_information.fields.fld_email_address.value;
    // Routing varies based on format and if for reserves...
    if (frmData.fld_is_this_for_course_reserves_.value === 'Yes') {
        // course reserve purchases for music and video do not go to acquisitions.
        // book and dissertation requests go to acquisitions.
        if (frmData.fld_format.value === 'Video') {
            libOptions.to = 'lib-reserves@virginia.edu';
            libOptions.bcc = 'Libselect_video@virginia.edu';
            libOptions.subject += ' to Reserves Librarian';
        } else if (frmData.fld_format.value === 'Music Score') {
            libOptions.to = 'lib-reserves@virginia.edu,lb-mu-scores@virginia.edu';
            libOptions.subject += ' to Reserves Librarian';
        } else {
            libOptions.to = 'lib-reserves@virginia.edu';
            if (frmData.fld_format.value === 'Music Recording') {
                libOptions.to += ',lb-mu-recordings@virginia.edu';
            }
            if (frmData.fld_format.value === 'Journal Subscription') {
                libOptions.subject += 'to Reserves Librarian';
            } else if (frmData.fld_format.value === 'Other') {
                libOptions.subject += 'to Acquisitions';
                libOptions.to += ',lib-orders@virginia.edu';
            } else if ((frmData.fld_format.value === 'Database') || (frmData.fld_format.value === 'Dataset')) {
                libOptions.to += ',lib-collections@virginia.edu,data@virginia.edu';
                libOptions.subject += 'to Reserves Librarian';
            } else if (frmData.fld_format.value === 'Dissertation or Thesis') {
                libOptions.to += ',lib-collections@virginia.edu';
                libOptions.subject += 'to Reserves Librarian';
            } else {
                libOptions.bcc += 'lib-orders@virginia.edu';
                libOptions.subject += 'to Acquisitions';
            }
        }
    } else {
        // not going on course reserve so gets routed...
        if (frmData.fld_format.value === 'Music Score') {
            libOptions.to = 'purchase-requests@virginia.libanswers.com,lb-mu-scores@virginia.edu';
            libOptions.subject += 'to Collection Librarians';
        } else if (frmData.fld_format.value === 'Music Recording') {
            libOptions.to = 'lb-mu-recordings@virginia.edu,lib-orders@virginia.edu';
            libOptions.subject += 'to Acquisitions';
        } else if (frmData.fld_format.value === 'Video') {
            libOptions.to = 'Libselect_video@virginia.edu';
            libOptions.subject += 'to Subject Librarian';
        } else if ((frmData.fld_format.value === 'Database') || (frmData.fld_format.value === 'Dataset')) {
            libOptions.to = 'purchase-requests@virginia.libanswers.com,data@virginia.edu';
            libOptions.subject += 'to Collection Librarians';
        } else {
            if (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value && (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value !== '')) {
                // Determine the routing based on the user department. Identify the subject librarian.
                switch (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value) {
                    case 'African-American and African Studies':
                        libOptions.to = 'lb-aaas-books@virginia.edu';
                        break;
                    case 'Anthropology':
                        libOptions.to = 'lib-anthropology-books@virginia.edu';
                        break;
                    case 'Archaeology':
                        libOptions.to = 'lib-archaeology-books@virginia.edu';
                        break;
                    case 'Architecture':
                    case 'Architectural History':
                    case 'Landscape Architecture':
                        libOptions.to = 'lib-architecture-books@virginia.edu';
                        break;
                    case 'Art':
                        libOptions.to = 'fal-purchase-req@virginia.edu';
                        break;
                    case 'Astronomy':
                        libOptions.to = 'lib-astronomy-books@virginia.edu';
                        break;
                    case 'Batten School':
                        libOptions.to = 'battenbooks@virginia.edu';
                        break;
                    case 'Biology':
                        libOptions.to = 'lib-biology-books@virginia.edu';
                        break;
                    case 'Biomedical Engineering':
                        libOptions.to = 'biomed-engineer-book@virginia.edu';
                        break;
                    case 'Chemical Engineering':
                        libOptions.to = 'chemical-engineer-book@virginia.edu';
                        break;
                    case 'Chemistry':
                        libOptions.to = 'lib-chemistry-books@virginia.edu';
                        break;
                    case 'Civil and Environmental Engineering':
                        libOptions.to = 'lib-civil-envi-books@virginia.edu';
                        break;
                    case 'Classics':
                        libOptions.to = 'lib-classics-books@virginia.edu';
                        break;
                    case 'Commerce':
                    case 'Economics':
                        libOptions.to = 'businessbooks@virginia.edu';
                        break;
                    case 'Computer Science':
                        libOptions.to = 'lib-comp-sci-books@virginia.edu';
                        break;
                    case 'Data Science':
                        libOptions.to = 'jah2ax@virginia.edu';
                        break;
                    case 'Drama':
                        libOptions.to = 'lib-drama-books@virginia.edu';
                        break;
                    case 'East Asian':
                        libOptions.to = 'lib-east-asian-books@virginia.edu';
                        break;
                    case 'Education':
                        libOptions.to = 'Education@virginia.edu';
                        break;
                    case 'Electrical and Computer Engineering':
                        libOptions.to = 'lib-elec-comp-books@virginia.edu';
                        break;
                    case 'English':
                        libOptions.to = 'lb-english@virginia.edu';
                        break;
                    case 'Environmental Sciences':
                        libOptions.to = 'lib-env-sci-books@virginia.edu';
                        break;
                    case 'French':
                        libOptions.to = 'lib-french-books@virginia.edu';
                        break;
                    case 'German':
                        libOptions.to = 'germanbooks@virginia.edu';
                        break;
                    case 'History':
                        libOptions.to = 'historybooks@virginia.edu';
                        break;
                    case 'Library':
                        libOptions.to = 'lib-library-requests@virginia.edu';
                        break;
                    case 'Materials Science and Engineering':
                        libOptions.to = 'material-sci-eng-books@virginia.edu';
                        break;
                    case 'Mathematics':
                        libOptions.to = 'lib-mathematics-books@virginia.edu';
                        break;
                    case 'Mechanical and Aerospace Engineering':
                        libOptions.to = 'lib-mech-aero-books@virginia.edu';
                        break;
                    case 'Media Studies':
                        libOptions.to = 'lb-media-studies-books@virginia.edu';
                        break;
                    case 'Middle Eastern and South Asian':
                        libOptions.to = 'mideast-southasia-book@virginia.edu';
                        break;
                    case 'Music':
                        libOptions.to = 'lb-mu-books@virginia.edu';
                        break;
                    case 'Other...':
                        libOptions.to = 'lib-collections@virginia.edu';
                        break;
                    case 'Philosophy':
                        libOptions.to = 'philosophybooks@virginia.edu';
                        break;
                    case 'Physics':
                        libOptions.to = 'lib-physics-books@virginia.edu';
                        break;
                    case 'Politics':
                        libOptions.to = 'politicsbooks@virginia.edu';
                        break;
                    case 'Psychology':
                        libOptions.to = 'lib-psychology-books@virginia.edu';
                        break;
                    case 'Religious Studies':
                        libOptions.to = 'relstudiesbooks@virginia.edu';
                        break;
                    case 'Science, Technology and Society':
                        libOptions.to = 'sci-tech-society-books@virginia.edu';
                        break;
                    case 'Slavic':
                        libOptions.to = 'slavicbooks@virginia.edu';
                        break;
                    case 'Sociology':
                        libOptions.to = 'lb-Sociology@virginia.edu';
                        break;
                    case 'Spanish, Italian, and Portuguese':
                        libOptions.to = 'span-ital-port-books@virginia.edu';
                        break;
                    case 'Statistics':
                        libOptions.to = 'lib-statistics-books@virginia.edu';
                        break;
                    case 'Systems and Information Engineering':
                        libOptions.to = 'lib-sys-info-books@virginia.edu';
                        break;
                    case 'Women, Gender, & Sexuality':
                        libOptions.to = 'lb-wgsbooks@virginia.edu';
                        break;
                    default:
                        libOptions.to = 'purchase-requests@virginia.libanswers.com';
                }
                switch (frmData.sect_requestor_information.fields.fld_lib_university_department_or_school.value) {
                    case 'African-American and African Studies':
                    case 'American Studies':
                    case 'Anthropology':
                    case 'Archaeology':
                    case 'Classics':
                    case 'Architecture':
                    case 'Architectural History':
                    case 'Landscape Architecture':
                    case 'Art':
                    case 'Astronomy':
                    case 'Batten School':
                    case 'Biology':
                    case 'Biomedical Engineering':
                    case 'Chemical Engineering':
                    case 'Chemistry':
                    case 'Civil and Environmental Engineering':
                    case 'Commerce':
                    case 'Computer Science':
                    case 'Data Science':
                    case 'Drama':
                    case 'East Asian':
                    case 'Economics':
                    case 'Electrical and Computer Engineering':
                    case 'Engineering':
                    case 'Education':
                    case 'English':
                    case 'Environmental Sciences':
                    case 'French':
                    case 'German':
                    case 'History':
                    case 'Materials Science and Engineering':
                    case 'Mathematics':
                    case 'Mechanical and Aerospace Engineering':
                    case 'Media Studies':
                    case 'Middle Eastern and South Asian':
                    case 'Music':
                    case 'Other...':
                    case 'Philosophy':
                    case 'Physics':
                    case 'Politics':
                    case 'Psychology':
                    case 'Religious Studies':
                    case 'Science, Technology and Society':
                    case 'Slavic':
                    case 'Sociology':
                    case 'Spanish, Italian, and Portuguese':
                    case 'Statistics':
                    case 'Systems and Information Engineering':
                    case 'Women, Gender, & Sexuality':
                        if ((frmData.fld_format.value === 'Book') || (frmData.fld_format.value === "eBook")) {
                            libOptions.to += ',lib-orders@virginia.edu,lib-collections@virginia.edu';
                            libOptions.subject += 'to Acquisitions';
                        } else if (frmData.fld_format.value === 'Dissertation or Thesis') {
                            libOptions.to += ',lib-collections@virginia.edu';
                            libOptions.subject += 'to Collection Librarians';
                        } else {
                            libOptions.subject += 'to Collection Librarians';
                            libOptions.to += ',purchase-requests@virginia.libanswers.com';
                        }
                        break;
                    default:
                        libOptions.subject += 'to Collection Librarians';
                }
            } else {
                libOptions.to = 'purchase-requests@virginia.libanswers.com';
                libOptions.subject += 'to Collection Librarians';
            }
        }

    }
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    libOptions.html = adminMsg + biblioInfo + requestorInfo + courseInfo + reqText;
    libOptions.text = stripHtml(adminMsg + biblioInfo + requestorInfo + courseInfo + reqText);

    // Prepare email confirmation content for patron
    userOptions.subject = (frmData.fld_is_this_for_course_reserves_.value && (frmData.fld_is_this_for_course_reserves_.value === "Yes")) ? 'Reserve ' : '';
    userOptions.subject += 'Purchase Recommendation';
    userOptions.to = frmData.sect_requestor_information.fields.fld_email_address.value;
    userOptions.html = patronMsg + biblioInfo + requestorInfo + courseInfo + reqText;
    userOptions.text = stripHtml(patronMsg + biblioInfo + requestorInfo + courseInfo + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, purchaseRecommendationDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}
async function processLibraryClassRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let instructorInfo = courseInfo = classPlanInfo = scheduleInfo = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let adminMsg = "<p><strong>* This email may contain attachments. It is recommended that you scan any attachments to make sure they do not contain a virus.</strong></p>\n\n";
    let patronMsg = "<p>Thank you for requesting a class with the Library. This email contains a copy of the information you submitted.</p><br>\n\n";
    patronMsg += "<p>Please contact libraryinstruction@virginia.edu if you have questions regarding this request.</p><br>\n\n";
    let data = { 'field_1550': reqId, 'ts_start': submitted };

    // Create instructor info output content and set appropriate LibInsight fields.
    instructorInfo += "\n<h3>"+frmData.sect_instructor_information.title+"</h3>\n\n<p>";
    if (frmData.sect_instructor_information.fields.fld_computing_id.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information.fields.fld_computing_id.label + "</strong><br>\n" + frmData.sect_instructor_information.fields.fld_computing_id.value + "<br>\n";
        data['field_1545'] = frmData.sect_instructor_information.fields.fld_computing_id.value;
    }
    if (frmData.sect_instructor_information.fields.fld_name.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information.fields.fld_name.label + "</strong><br>\n" + frmData.sect_instructor_information.fields.fld_name.value + "<br>\n";
        data['field_1546'] = frmData.sect_instructor_information.fields.fld_name.value;
    }
    if (frmData.sect_instructor_information.fields.fld_email_address.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information.fields.fld_email_address.label + "</strong><br>\n" + frmData.sect_instructor_information.fields.fld_email_address.value + "<br>\n";
        data['field_1547'] = frmData.sect_instructor_information.fields.fld_email_address.value;
    }
    if (frmData.sect_instructor_information.fields.fld_university_department_or_school.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information.fields.fld_university_department_or_school.label + "</strong><br>\n" + frmData.sect_instructor_information.fields.fld_university_department_or_school.value + "<br>\n";
        data['field_1548'] = frmData.sect_instructor_information.fields.fld_university_department_or_school.value;
        if (frmData.sect_instructor_information.fields.fld_university_department_or_school.value === "Other..."
            && frmData.sect_instructor_information.fields.fld_other_department_or_school.value) {
            instructorInfo += "<strong>" + frmData.sect_instructor_information.fields.fld_other_department_or_school.label + "</strong><br>\n" + frmData.sect_instructor_information.fields.fld_other_department_or_school.value + "<br>\n";
            data['field_1549'] = frmData.sect_instructor_information.fields.fld_other_department_or_school.value;
        }
    }
    instructorInfo += "</p><br>\n";
    // Create course info output content and set appropriate LibInsight fields.
    courseInfo += "\n<h3>"+frmData.sect_course_information.title+"</h3>\n\n<p>";
    if (frmData.sect_course_information.fields.fld_course_section_selector.value.term) {
        courseInfo += "<strong>Term</strong><br>\n" + frmData.sect_course_information.fields.fld_course_section_selector.value.term + "<br>\n";
        data['field_1528'] = frmData.sect_course_information.fields.fld_course_section_selector.value.term;
    }
    if (frmData.sect_course_information.fields.fld_course_section_selector.value.course) {
        courseInfo += "<strong>Course</strong><br>\n" + frmData.sect_course_information.fields.fld_course_section_selector.value.course + "<br>\n";
        data['field_1529'] = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
    }
    if (frmData.sect_course_information.fields.fld_course_section_selector.value.section) {
        courseInfo += "<strong>Course section</strong><br>\n" + frmData.sect_course_information.fields.fld_course_section_selector.value.section + "<br>\n";
        data['field_1530'] = frmData.sect_course_information.fields.fld_course_section_selector.value.section;
    }
    if (frmData.sect_course_information.fields.fld_course_section_selector.value.title) {
        courseInfo += "<strong>Course title</strong><br>\n" + frmData.sect_course_information.fields.fld_course_section_selector.value.title + "<br>\n";
        data['field_1531'] = frmData.sect_course_information.fields.fld_course_section_selector.value.title;
    }
    if (frmData.sect_course_information.fields.fld_course_section_selector.value.meetingTime) {
        courseInfo += "<strong>Meeting time</strong><br>\n" + frmData.sect_course_information.fields.fld_course_section_selector.value.meetingTime + "<br>\n";
        data['field_1532'] = frmData.sect_course_information.fields.fld_course_section_selector.value.meetingTime;
    }
    if (frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment) {
        courseInfo += "<strong>Enrollment</strong><br>\n" + frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment + "<br>\n";
        data['field_1533'] = frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment;
    }
    courseInfo += "</p><br>\n";
    // Create schedule info output content and set appropriate LibInsight fields.
    scheduleInfo += "\n<h3>"+frmData.sect_scheduling_information.title+"</h3>\n\n";
    if (frmData.sect_scheduling_information.fields.fld_preferred_dates_for_sessions.value.data && frmData.sect_scheduling_information.fields.fld_preferred_dates_for_sessions.value.data.length > 0) {
        let numSessions = 0;
        for (let i=0; i < frmData.sect_scheduling_information.fields.fld_preferred_dates_for_sessions.value.data.length; i++) {
            if (frmData.sect_scheduling_information.fields.fld_preferred_dates_for_sessions.value.data[i].show) numSessions++;
        }
        scheduleInfo += "<p><strong>Sessions requested</strong><br>\n" + numSessions + "<br>\n</p>";
        data['field_1551'] = numSessions;
        for (let i=0; i < frmData.sect_scheduling_information.fields.fld_preferred_dates_for_sessions.value.data.length; i++) {
            const session = frmData.sect_scheduling_information.fields.fld_preferred_dates_for_sessions.value.data[i];
            if (session.show) {
                const sessionText = sessionLengthAndChoicesToString(session);
                scheduleInfo += sessionText + "<hr>";
                if (session.nth === 1) {
                    data['field_1535'] = stripHtml(sessionText);
                } else if (session.nth === 2) {
                    data['field_1537'] = stripHtml(sessionText);
                } else {
                    data['field_1539'] = stripHtml(sessionText);
                }
            }
        }
    }
    scheduleInfo += "<br>\n";
    // Create class planning info output content and set appropriate LibInsight fields.
    classPlanInfo += "\n<h3>"+frmData.sect_class_planning.title+"</h3>\n\n<p>";
    if (frmData.sect_class_planning.fields.fld_what_kind_of_software.value) {
        classPlanInfo += "<strong>" + frmData.sect_class_planning.fields.fld_what_kind_of_software.label + "</strong><br>\n" + frmData.sect_class_planning.fields.fld_what_kind_of_software.value + "<br>\n";
        data['field_1540'] = frmData.sect_class_planning.fields.fld_what_kind_of_software.value;
    }
    if (frmData.sect_class_planning.fields.fld_course_syllabus.value && (frmData.sect_class_planning.fields.fld_course_syllabus.value.fids.length > 0)) {
        const firebaseFilename = (frmData.sect_class_planning.fields.fld_course_syllabus.value.fids.length > 0) ? frmData.sect_class_planning.fields.fld_course_syllabus.value.fids[0] : '';
        if (firebaseFilename !== "") {
            libOptions.attach_type = userOptions.attach_type = (frmData.sect_class_planning.fields.fld_course_syllabus.email_type) ? frmData.sect_class_planning.fields.fld_course_syllabus.email_type : 'attach';
            libOptions.sourceFile = userOptions.sourceFile = firebaseFilename;
            libOptions.destFile = userOptions.destFile = firebaseFilename.substring(firebaseFilename.indexOf('_')+1);
            classPlanInfo += "<strong>" + frmData.sect_class_planning.fields.fld_course_syllabus.label + " file name</strong><br>\n" + libOptions.destFile + "<br>\n";
            data['field_1541'] = libOptions.destFile;  //since this file upload is an attachment, use the actual file name uploaded in LibInsight
        }
    }
    if (frmData.sect_class_planning.fields.fld_course_objectives_or_learning_outcomes.value) {
        classPlanInfo += "<strong>" + frmData.sect_class_planning.fields.fld_course_objectives_or_learning_outcomes.label + "</strong><br>\n" + frmData.sect_class_planning.fields.fld_course_objectives_or_learning_outcomes.value + "<br>\n";
        data['field_1542'] = frmData.sect_class_planning.fields.fld_course_objectives_or_learning_outcomes.value;
    }
    if (frmData.sect_class_planning.fields.fld_assigment_sheet.value && (frmData.sect_class_planning.fields.fld_assigment_sheet.value.fids.length > 0)) {
        const firebaseFilename = (frmData.sect_class_planning.fields.fld_assigment_sheet.value.fids.length > 0) ? frmData.sect_class_planning.fields.fld_assigment_sheet.value.fids[0] : '';
        if (firebaseFilename !== "") {
            libOptions.attach_type1 = userOptions.attach_type1 = (frmData.sect_class_planning.fields.fld_assigment_sheet.email_type) ? frmData.sect_class_planning.fields.fld_assigment_sheet.email_type : 'attach';
            libOptions.sourceFile1 = userOptions.sourceFile1 = firebaseFilename;
            libOptions.destFile1 = userOptions.destFile1 = firebaseFilename.substring(firebaseFilename.indexOf('_')+1);
            classPlanInfo += "<strong>" + frmData.sect_class_planning.fields.fld_assigment_sheet.label + " file name</strong><br>\n" + libOptions.destFile1 + "<br>\n";
            data['field_1543'] = libOptions.destFile1;  //since this file upload is an attachment, use the actual file name uploaded in LibInsight
        }
    }
    if (frmData.sect_class_planning.fields.fld_who_have_you_consulted_with.value) {
        classPlanInfo += "<strong>" + frmData.sect_class_planning.fields.fld_who_have_you_consulted_with.label + "</strong><br>\n" + frmData.sect_class_planning.fields.fld_who_have_you_consulted_with.value + "<br>\n";
        data['field_1544'] = frmData.sect_class_planning.fields.fld_who_have_you_consulted_with.value;
    }
    classPlanInfo += "</p><br>\n";

    libOptions.from = frmData.sect_instructor_information.fields.fld_email_address.value;
    libOptions.replyTo = frmData.sect_instructor_information.fields.fld_email_address.value;
    libOptions.to = 'libraryinstruction@virginia.edu';
    libOptions.subject = 'Library Class Request: '+frmData.sect_instructor_information.fields.fld_name.value;
    libOptions.html = adminMsg + patronMsg + instructorInfo + courseInfo + scheduleInfo + classPlanInfo + reqText;
    libOptions.text = stripHtml(adminMsg + patronMsg + instructorInfo + courseInfo + scheduleInfo + classPlanInfo + reqText);

    // Prepare email confirmation content for patron
    userOptions.from = '"Teaching and Learning Instruction" <libraryinstruction@virginia.edu>';
    userOptions.subject = libOptions.subject;
    userOptions.to = frmData.sect_instructor_information.fields.fld_email_address.value;
    userOptions.html = patronMsg + instructorInfo + courseInfo + scheduleInfo + classPlanInfo + reqText;
    userOptions.text = stripHtml(patronMsg + instructorInfo + courseInfo + scheduleInfo + classPlanInfo + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, requestLibraryClassDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processSpecCollInstructionRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let contactInfo = courseInfo = sessionInfo = scheduleInfo = commentInfo = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let adminMsg = "<p><strong>* This email may contain an attachment. It is recommended that you scan the attachment to make sure it does not contain a virus.</strong></p>\n\n";
    let patronMsg = "<p>Thank you for contacting the Small Special Collection Library. This email contains a copy of the information you submitted.</p><br>\n\n";
    patronMsg += "<p>Please contact Krystal Appiah (ka7uz@virginia.edu / 434-243-8194) or Heather Riser (mhm8m@virginia.edu / 434-924-4966) if you have questions regarding this request.</p><br>\n\n";
    let data = { 'field_874': reqId, 'ts_start': submitted };

    // Create contact info output content and set appropriate LibInsight fields.
    contactInfo += "\n<h3>"+frmData.sect_your_contact_information.title+"</h3>\n\n<p>";
    if (frmData.sect_your_contact_information.fields.fld_name.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_name.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_name.value + "<br>\n";
        data['field_877'] = frmData.sect_your_contact_information.fields.fld_name.value;
    }
    if (frmData.sect_your_contact_information.fields.fld_email_address.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_email_address.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_email_address.value + "<br>\n";
        data['field_878'] = frmData.sect_your_contact_information.fields.fld_email_address.value;
    }
    if (frmData.sect_your_contact_information.fields.fld_phone_number.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_phone_number.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_phone_number.value + "<br>\n";
        data['field_879'] = frmData.sect_your_contact_information.fields.fld_phone_number.value;
    }
    if (frmData.sect_your_contact_information.fields.fld_department.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_department.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_department.value + "<br>\n";
        data['field_880'] = frmData.sect_your_contact_information.fields.fld_department.value;
    }
    if (frmData.sect_your_contact_information.fields.fld_uva_affiliation.value) {
        contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_uva_affiliation.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_uva_affiliation.value + "<br>\n";
        data['field_881'] = frmData.sect_your_contact_information.fields.fld_uva_affiliation.value;
        if (frmData.sect_your_contact_information.fields.fld_uva_affiliation.value === "Unaffiliated"
            && frmData.sect_your_contact_information.fields.fld_please_list_your_group_or_institution.value) {
            contactInfo += "<strong>" + frmData.sect_your_contact_information.fields.fld_please_list_your_group_or_institution.label + "</strong><br>\n" + frmData.sect_your_contact_information.fields.fld_please_list_your_group_or_institution.value + "<br>\n";
            data['field_882'] = frmData.sect_your_contact_information.fields.fld_please_list_your_group_or_institution.value;
        }
    }
    contactInfo += "</p><br>\n";
    // Create course info output content and set appropriate LibInsight fields.
    if ((frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.course)
        || (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.section)
        || (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.title)
        || (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.enrollment)
        || (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value && (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value.fids.length > 0))) {
        courseInfo += "\n<h3>"+frmData.sect_course_information_if_applicable_.title+"</h3>\n\n<p>";
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.term) {
            courseInfo += "<strong>Term</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.term + "<br>\n";
            data['field_883'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.term;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.course) {
            courseInfo += "<strong>Course</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.course + "<br>\n";
            data['field_884'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.course;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.section) {
            courseInfo += "<strong>Course section</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.section + "<br>\n";
            data['field_885'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.section;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.title) {
            courseInfo += "<strong>Course title</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.title + "<br>\n";
            data['field_886'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.title;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.enrollment) {
            courseInfo += "<strong>Enrollment</strong><br>\n" + frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.enrollment + "<br>\n";
            data['field_887'] = frmData.sect_course_information_if_applicable_.fields.fld_course_section_selector.value.enrollment;
        }
        if (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value && (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value.fids.length > 0)) {
            const firebaseFilename = (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value.fids.length > 0) ? frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.value.fids[0] : '';
            if (firebaseFilename !== "") {
                libOptions.attach_type = userOptions.attach_type = (frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.email_type) ? frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.email_type : 'attach';
                libOptions.sourceFile = userOptions.sourceFile = firebaseFilename;
                libOptions.destFile = userOptions.destFile = firebaseFilename.substring(firebaseFilename.indexOf('_')+1);
                courseInfo += "<strong>" + frmData.sect_course_information_if_applicable_.fields.fld_course_syllabus.label + " file name</strong><br>\n" + libOptions.destFile + "<br>\n";
                data['field_941'] = firebaseFilename; // since this file is saved and linked to, use the firebase filename in LibInsight
            }
        }
        courseInfo += "</p><br>\n";
    }
    // Create session info output content and set appropriate LibInsight fields.
    sessionInfo += "\n<h3>"+frmData.sect_session_information.title+"</h3>\n\n<p>";

    if (frmData.sect_session_information.fields.fld_session_format && frmData.sect_session_information.fields.fld_session_format.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_session_format.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_session_format.value + "<br>\n";
        data['field_1552'] = frmData.sect_session_information.fields.fld_session_format.value;
    }
    if (!isObjectEmpty(frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value)) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.label + "</strong><br>\n";
        sessionInfo += "<ul>";
        for (let key in frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value) {
            sessionInfo += "<li>" + frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value[key] + "</li>\n";
        }
        sessionInfo += "</ul><br>\n";
        data['field_888'] = Object.keys(frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value).join(', ');
        if (frmData.sect_session_information.fields.fld_what_kind_of_instruction_would_you_like.value.hasOwnProperty("Course related instruction")) {
            sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_for_course_related_instruction.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_for_course_related_instruction.value + "<br>\n";
            data['field_889'] = frmData.sect_session_information.fields.fld_for_course_related_instruction.value;
        }
    }
    if (frmData.sect_session_information.fields.fld_number_of_participants.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_number_of_participants.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_number_of_participants.value + "<br>\n";
        data['field_890'] = frmData.sect_session_information.fields.fld_number_of_participants.value;
    }
    if (!isObjectEmpty(frmData.sect_session_information.fields.fld_level_of_participants.value)) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_level_of_participants.label + "</strong><br>\n";
        sessionInfo += "<ul>";
        for (let key in frmData.sect_session_information.fields.fld_level_of_participants.value) {
            sessionInfo += "<li>" + frmData.sect_session_information.fields.fld_level_of_participants.value[key] + "</li>\n";
        }
        sessionInfo += "</ul><br>\n";
        data['field_891'] = Object.keys(frmData.sect_session_information.fields.fld_level_of_participants.value).join(', ');
        if (frmData.sect_session_information.fields.fld_level_of_participants.value.hasOwnProperty("Unaffiliated")) {
            if (frmData.sect_session_information.fields.fld_name_of_group_or_institution_if_applicable_.value) {
                sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_name_of_group_or_institution_if_applicable_.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_name_of_group_or_institution_if_applicable_.value + "<br>\n";
                data['field_892'] = frmData.sect_session_information.fields.fld_name_of_group_or_institution_if_applicable_.value;
            }
        }
    }
    if (frmData.sect_session_information.fields.fld_explanation_of_instructional_needs.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_explanation_of_instructional_needs.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_explanation_of_instructional_needs.value + "<br>\n";
        data['field_893'] = frmData.sect_session_information.fields.fld_explanation_of_instructional_needs.value;
    }
    if (frmData.sect_session_information.fields.fld_goals_for_session.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_goals_for_session.label + "</strong><br>\n" + frmData.sect_session_information.fields.fld_goals_for_session.value + "<br>\n";
        data['field_894'] = frmData.sect_session_information.fields.fld_goals_for_session.value;
    }
    if (frmData.sect_session_information.fields.fld_are_there_specific_materials_you_would_like_to_cover_.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_are_there_specific_materials_you_would_like_to_cover_.label + ":</strong><br>\n";
        sessionInfo += (frmData.sect_session_information.fields.fld_are_there_specific_materials_you_would_like_to_cover_.value === 1) ? 'Yes' : 'No';
        sessionInfo += "<br>\n";
        data['field_895'] = (frmData.sect_session_information.fields.fld_are_there_specific_materials_you_would_like_to_cover_.value === 1) ? 'Yes' : 'No';
    }
    if (frmData.sect_session_information.fields.fld_materials_to_cover && frmData.sect_session_information.fields.fld_materials_to_cover.value && (frmData.sect_session_information.fields.fld_materials_to_cover.value.fids.length > 0)) {
        const firebaseFilename = (frmData.sect_session_information.fields.fld_materials_to_cover.value.fids.length > 0) ? frmData.sect_session_information.fields.fld_materials_to_cover.value.fids[0] : '';
        if (firebaseFilename !== "") {
            libOptions.attach_type1 = userOptions.attach_type1 = (frmData.sect_session_information.fields.fld_materials_to_cover.email_type) ? frmData.sect_session_information.fields.fld_materials_to_cover.email_type : 'attach';
            libOptions.sourceFile1 = userOptions.sourceFile1 = firebaseFilename;
            libOptions.destFile1 = userOptions.destFile1 = firebaseFilename.substring(firebaseFilename.indexOf('_')+1);
            sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_materials_to_cover.label + " file name</strong><br>\n" + libOptions.destFile1 + "<br>\n";
            data['field_1553'] = firebaseFilename; // since this file is saved and linked to, use the firebase filename in LibInsight
        }
    }
    if (frmData.sect_session_information.fields.fld_do_you_need_audiovisual_support_for_your_class_.value) {
        sessionInfo += "<strong>" + frmData.sect_session_information.fields.fld_do_you_need_audiovisual_support_for_your_class_.label + ":</strong><br>\n";
        sessionInfo += (frmData.sect_session_information.fields.fld_do_you_need_audiovisual_support_for_your_class_.value === 1) ? 'Yes' : 'No';
        sessionInfo += "<br>\n";
        data['field_896'] = (frmData.sect_session_information.fields.fld_do_you_need_audiovisual_support_for_your_class_.value === 1) ? 'Yes' : 'No';
    }
    sessionInfo += "</p><br>\n";
    // Create session info output content and set appropriate LibInsight fields.
    scheduleInfo += "\n<h3>"+frmData.sect_scheduling_information.title+"</h3>\n\n";
    if (frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data && frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data.length > 0) {
        let numSessions = 0;
        for (let i=0; i < frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data.length; i++) {
            if (frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data[i].show) numSessions++;
        }
        scheduleInfo += "<p><strong>Sessions requested</strong><br>\n" + numSessions + "<br>\n</p>";
        data['field_897'] = numSessions;
        for (let i=0; i < frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data.length; i++) {
            const session = frmData.sect_scheduling_information.fields.fld_session_date_time_preferences.value.data[i];
            if (session.show) {
                const sessionText = sessionLengthAndChoicesToString(session);
                scheduleInfo += sessionText + "<hr>";
                if (session.nth === 1) {
                    data['field_898'] = stripHtml(sessionText);
                } else if (session.nth === 2) {
                    data['field_899'] = stripHtml(sessionText);
                } else if (session.nth === 3) {
                    data['field_900'] = stripHtml(sessionText);
                } else if (session.nth === 4) {
                    data['field_901'] = stripHtml(sessionText);
                } else if (session.nth === 5) {
                    data['field_902'] = stripHtml(sessionText);
                } else {
                    data['field_903'] = stripHtml(sessionText);
                }
            }
        }
    }
    scheduleInfo += "<br>\n";
    // Create comment info output if there is any.
    if (frmData.fld_comments.value) {
        commentInfo += "<br>\n";
        commentInfo += "<strong>" + frmData.fld_comments.label + "</strong><br>\n" + frmData.fld_comments.value + "<br>\n";
        data['field_904'] = frmData.fld_comments.value;
    }

    libOptions.from = frmData.sect_your_contact_information.fields.fld_email_address.value;
    libOptions.replyTo = frmData.sect_your_contact_information.fields.fld_email_address.value;
    libOptions.to = 'mhm8m@virginia.edu,ka7uz@virginia.edu';
    libOptions.subject = 'Small Special Collections Instruction Request: '+frmData.sect_your_contact_information.fields.fld_name.value;
    libOptions.html = adminMsg + patronMsg + contactInfo + courseInfo + sessionInfo + scheduleInfo + commentInfo + reqText;
    libOptions.text = stripHtml(adminMsg + patronMsg + contactInfo + courseInfo + sessionInfo + scheduleInfo + commentInfo + reqText);

    // Prepare email confirmation content for patron
    userOptions.subject = 'Small Special Collections Instruction Request';
    userOptions.to = frmData.sect_your_contact_information.fields.fld_email_address.value;
    userOptions.html = patronMsg + contactInfo + courseInfo + sessionInfo + scheduleInfo + commentInfo + reqText;
    userOptions.text = stripHtml(patronMsg + contactInfo + courseInfo + sessionInfo + scheduleInfo + commentInfo + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, specCollInstructionDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processPersonalCopyReserveRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let instructorInfo = courseInfo = materialsInfo = msg = instructorName = instructorEmail = courseNum = materials = itemDetails = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let data = { 'field_967': reqId, 'ts_start': submitted, 'ts_end': submitted };

    // Prepare email message body and LibInsight data parameters
    instructorInfo += "\n<h3>"+frmData.sect_instructor_information_.title+"</h3>\n\n<p>";
    if (frmData.sect_instructor_information_.fields.fld_uva_computing_id.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_uva_computing_id.value + "<br>\n";
        data['field_948'] = frmData.sect_instructor_information_.fields.fld_uva_computing_id.value;
    }
    if (frmData.sect_instructor_information_.fields.fld_name.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_name.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_name.value + "<br>\n";
        data['field_946'] = frmData.sect_instructor_information_.fields.fld_name.value;
        instructorName = frmData.sect_instructor_information_.fields.fld_name.value;
    }
    if (frmData.sect_instructor_information_.fields.fld_email_address.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_email_address.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_email_address.value + "<br>\n";
        data['field_947'] = frmData.sect_instructor_information_.fields.fld_email_address.value;
        instructorEmail = frmData.sect_instructor_information_.fields.fld_email_address.value;
    }
    if (frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.value + "<br>\n";
        data['field_944'] = frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.value;
        if (frmData.sect_instructor_information_.fields.fld_are_you_making_this_request_on_behalf_of_the_instructor.value === 'Yes') {
            if (frmData.sect_instructor_information_.fields.fld_instructor_name.value) {
                instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_instructor_name.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_instructor_name.value + "<br>\n";
                data['field_949'] = frmData.sect_instructor_information_.fields.fld_instructor_name.value;
                instructorName = frmData.sect_instructor_information_.fields.fld_instructor_name.value;
            }
            if (frmData.sect_instructor_information_.fields.fld_instructor_email_address.value) {
                instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_instructor_email_address.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_instructor_email_address.value + "<br>\n";
                data['field_950'] = frmData.sect_instructor_information_.fields.fld_instructor_email_address.value;
                instructorEmail = frmData.sect_instructor_information_.fields.fld_instructor_email_address.value;
            }
        }
    }
    if (frmData.sect_instructor_information_.fields.fld_phone_number_.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_phone_number_.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_phone_number_.value + "<br>\n";
        data['field_951'] = frmData.sect_instructor_information_.fields.fld_phone_number_.value;
    }
    if (frmData.sect_instructor_information_.fields.fld_university_department_or_school.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_university_department_or_school.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_university_department_or_school.value + "<br>\n";
        data['field_952'] = frmData.sect_instructor_information_.fields.fld_university_department_or_school.value;
        if (frmData.sect_instructor_information_.fields.fld_university_department_or_school.value === 'Other...') {
            instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_other_department.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_other_department.value + "<br>\n";
            data['field_953'] = frmData.sect_instructor_information_.fields.fld_other_department.value;
        }
    }
    if (frmData.sect_instructor_information_.fields.fld_messenger_mail_or_leo_delivery_address.value) {
        instructorInfo += "<strong>" + frmData.sect_instructor_information_.fields.fld_messenger_mail_or_leo_delivery_address.label + ":</strong> " + frmData.sect_instructor_information_.fields.fld_messenger_mail_or_leo_delivery_address.value + "<br>\n";
        data['field_954'] = frmData.sect_instructor_information_.fields.fld_messenger_mail_or_leo_delivery_address.value;
    }
    instructorInfo += "</p><br>\n";

    courseInfo += "\n<h3>"+frmData.sect_course_information.title+"</h3>\n\n<p>";
    if (frmData.sect_course_information.fields.fld_course_section_selector.value) {
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.term) {
            courseInfo += "<strong>Term:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.term + "<br>\n";
            data['field_955'] = frmData.sect_course_information.fields.fld_course_section_selector.value.term;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.course) {
            courseInfo += "<strong>Course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.course + "<br>\n";
            data['field_956'] = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
            courseNum = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.section) {
            courseInfo += "<strong>Section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.section + "<br>\n";
            data['field_957'] = frmData.sect_course_information.fields.fld_course_section_selector.value.section;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse) {
            courseInfo += "<strong>Alternate course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse + "<br>\n";
            data['field_958'] = frmData.sect_course_information.fields.fld_course_section_selector.value.altCourse;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.altSection) {
            courseInfo += "<strong>Alternate course section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.altSection + "<br>\n";
            data['field_959'] = frmData.sect_course_information.fields.fld_course_section_selector.value.altSection;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.title) {
            courseInfo += "<strong>Title:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.title + "<br>\n";
            data['field_960'] = frmData.sect_course_information.fields.fld_course_section_selector.value.title;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment) {
            courseInfo += "<strong>Enrollment:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment + "<br>\n";
            data['field_961'] = frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment;
        }
    }
    if (frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value) {
        courseInfo += "<strong>" + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.label + ":</strong> " + frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value + "<br>\n";
        data['field_962'] = frmData.sect_course_information.fields.fld_at_which_library_should_this_item_go_on_reserve_.value;
    }
    courseInfo += "</p><br>\n";

    materialsInfo += "\n<h3>"+frmData.sect_materials_for_reserve.title+"</h3>\n\n<p>";
    materialsInfo += "\n<strong>Personal copies will be assigned a 3 hour loan period.</strong><br><br>\n\n";
    if (frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.value) {
        materialsInfo += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.value + "<br><br>\n\n";
        data['field_963'] = frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.value;
        materials = frmData.sect_materials_for_reserve.fields.fld_personal_items_consist_of.value;
    }
    if (frmData.sect_materials_for_reserve.fields.fld_item_1_title.value) {
        itemDetails = '';
        if (materials === 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_1_format_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_1_format_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_1_format_media.value + "<br>\n";
            }
        }
        if (materials === 'Print materials and Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_1_format_print_and_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_1_format_print_and_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_1_format_print_and_media.value + "<br>\n";
            }
        }
        if (materials !== 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_1_author.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_1_author.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_1_author.value + "<br>\n";
            }
        }
        itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_1_title.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_1_title.value + "<br>\n";
        materialsInfo += itemDetails;
        data['field_964'] = stripHtml(itemDetails);
    }
    if (frmData.sect_materials_for_reserve.fields.fld_item_2_title.value) {
        itemDetails = '<hr>';
        if (materials === 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_2_format_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_2_format_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_2_format_media.value + "<br>\n";
            }
        }
        if (materials === 'Print materials and Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_2_format_print_and_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_2_format_print_and_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_2_format_print_and_media.value + "<br>\n";
            }
        }
        if (materials !== 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_2_author.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_2_author.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_2_author.value + "<br>\n";
            }
        }
        itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_2_title.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_2_title.value + "<br>\n";
        materialsInfo += itemDetails;
        data['field_965'] = stripHtml(itemDetails);
    }
    if (frmData.sect_materials_for_reserve.fields.fld_item_3_title.value) {
        itemDetails = '<hr>';
        if (materials === 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_3_format_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_3_format_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_3_format_media.value + "<br>\n";
            }
        }
        if (materials === 'Print materials and Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_3_format_print_and_media.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_3_format_print_and_media.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_3_format_print_and_media.value + "<br>\n";
            }
        }
        if (materials !== 'Media') {
            if (frmData.sect_materials_for_reserve.fields.fld_item_3_author.value) {
                itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_3_author.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_3_author.value + "<br>\n";
            }
        }
        itemDetails += "<strong>" + frmData.sect_materials_for_reserve.fields.fld_item_3_title.label + ":</strong> " + frmData.sect_materials_for_reserve.fields.fld_item_3_title.value + "<br>\n";
        materialsInfo += itemDetails;
        data['field_966'] = stripHtml(itemDetails);
    }
    materialsInfo += "</p><br>\n";

    // Prepare email content for Library staff
    libOptions.from = instructorEmail;
    libOptions.replyTo = instructorEmail;
    libOptions.to = 'lib-reserves@virginia.edu';
    libOptions.subject = 'Personal Copy - ' + instructorName + ' ' + courseNum;
    if (materials === 'Media') {
        msg = "<p>RMC copy to handle media content for this personal copy request.</p><br>\n\n";
    } else {
        msg = '';
    }
    libOptions.html = msg + instructorInfo + courseInfo + materialsInfo + reqText;
    libOptions.text = stripHtml(msg + instructorInfo + courseInfo + materialsInfo + reqText);

    // Prepare second email content for Library staff. NOTE: Service Desk generates confirmation to patron.
    // This email only needs to be sent to Reserves if person has selected print materials and media requiring second ticket created.
    msg = "<p>RMC copy generated to handle media content for this personal copy request.</p><br>\n\n";
    userOptions.from = instructorEmail;
    userOptions.replyTo = instructorEmail;
    if (materials === 'Print materials and Media') {
        userOptions.to = 'lib-reserves@virginia.edu';
    } else {
        // send second unneeded email here so that it doesn't generate extra ticket in Service Desk;
        // (form workflow assumes 2 emails generated for each submission: library staff and other is confirmation)
        userOptions.to = 'no-reply-library@virginia.edu';
    }
    userOptions.subject = 'Personal Copy - ' + instructorName + ' ' + courseNum;
    userOptions.html = msg + instructorInfo + courseInfo + materialsInfo + reqText;
    userOptions.text = stripHtml(msg + instructorInfo + courseInfo + materialsInfo + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, personalCopyReserveDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processResearchTutorialRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let requestorInfo = courseInfo = dateInfo = projInfo = requestorName = requestorEmail = msg = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let data = { 'field_1003': reqId, 'ts_start': submitted, 'ts_end': submitted };

    // Prepare email message body and LibInsight data parameters
    requestorInfo += "\n<h3>"+frmData.sect_requestor_information.title+"</h3>\n\n<p>";
    if (frmData.sect_requestor_information.fields.fld_uva_computing_id.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_uva_computing_id.value + "<br>\n";
        data['field_985'] = frmData.sect_requestor_information.fields.fld_uva_computing_id.value;
    }
    if (frmData.sect_requestor_information.fields.fld_name.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_name.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_name.value + "<br>\n";
        data['field_986'] = frmData.sect_requestor_information.fields.fld_name.value;
        requestorName = frmData.sect_requestor_information.fields.fld_name.value;
    }
    if (frmData.sect_requestor_information.fields.fld_email_address.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_email_address.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_email_address.value + "<br>\n";
        data['field_987'] = frmData.sect_requestor_information.fields.fld_email_address.value;
        requestorEmail = frmData.sect_requestor_information.fields.fld_email_address.value;
    }
    if (frmData.sect_requestor_information.fields.fld_phone_number.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_phone_number.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_phone_number.value + "<br>\n";
        data['field_988'] = frmData.sect_requestor_information.fields.fld_phone_number.value;
    }
    if (frmData.sect_requestor_information.fields.fld_university_affiliation.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_affiliation.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_affiliation.value + "<br>\n";
        data['field_989'] = frmData.sect_requestor_information.fields.fld_university_affiliation.value;
    }
    if (frmData.sect_requestor_information.fields.fld_university_department_or_school.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_department_or_school.value + "<br>\n";
        data['field_990'] = frmData.sect_requestor_information.fields.fld_university_department_or_school.value;
        if (frmData.sect_requestor_information.fields.fld_university_department_or_school.value === 'Other...') {
            requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_other_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_other_department_or_school.value + "<br>\n";
            data['field_991'] = frmData.sect_requestor_information.fields.fld_other_department_or_school.value;
        }
    }
    requestorInfo += "</p><br>\n";

    courseInfo += "\n<h3>"+frmData.sect_course_information.title+"</h3>\n\n<p>";
    if (frmData.sect_course_information.fields.fld_course_section_selector.value) {
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.term) {
            courseInfo += "<strong>Term:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.term + "<br>\n";
            data['field_992'] = frmData.sect_course_information.fields.fld_course_section_selector.value.term;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.course) {
            courseInfo += "<strong>Course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.course + "<br>\n";
            data['field_993'] = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
            courseNum = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.section) {
            courseInfo += "<strong>Section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.section + "<br>\n";
            data['field_994'] = frmData.sect_course_information.fields.fld_course_section_selector.value.section;
        }
        if (frmData.sect_course_information.fields.fld_course_section_selector.value.title) {
            courseInfo += "<strong>Title:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.title + "<br>\n";
            data['field_995'] = frmData.sect_course_information.fields.fld_course_section_selector.value.title;
        }
    }
    courseInfo += "</p><br>\n";
    dateInfo += "\n<h3>"+frmData.sect_tutorial_date.title+"</h3><p>\n\n";
    if (frmData.sect_tutorial_date.fields.fld_preferred_dates.value.sessionDateTime && frmData.sect_tutorial_date.fields.fld_preferred_dates.value.sessionDateTime.length > 0) {
        for (let i=0; i < frmData.sect_tutorial_date.fields.fld_preferred_dates.value.sessionDateTime.length; i++) {
            const choice = frmData.sect_tutorial_date.fields.fld_preferred_dates.value.sessionDateTime[i];
            let choiceStr = choiceDateTimeToString(choice);
            dateInfo += choiceStr;
            if (choice.nth === 1) {
                data['field_996'] = stripHtml(choiceStr);
            } else {
                data['field_999'] = stripHtml(choiceStr);
            }
        }
    }
    dateInfo += "</p><br>\n";
    projInfo += "\n<h3>"+frmData.sect_project_research_topic.title+"</h3><p>\n\n";
    if (frmData.sect_project_research_topic.fields.fld_please_briefly_describe_your_project_or_research_topic.value) {
        projInfo += "<strong>" + frmData.sect_project_research_topic.fields.fld_please_briefly_describe_your_project_or_research_topic.label + ":</strong><br>\n" + frmData.sect_project_research_topic.fields.fld_please_briefly_describe_your_project_or_research_topic.value + "<br>\n";
        data['field_1002'] = frmData.sect_project_research_topic.fields.fld_please_briefly_describe_your_project_or_research_topic.value;
    }
    projInfo += "</p><br>\n";
    msg = "<p>The request below was submitted through the Research Tutorial Request Form:</p><br>\n\n";

    // Prepare email content for Library staff
    libOptions.from = '"'+requestorName+'" <'+requestorEmail+'>';
    libOptions.replyTo = requestorEmail;
    libOptions.to = 'kw6m@virginia.edu';
    libOptions.subject = 'Research tutorial requested';
    libOptions.html = msg + requestorInfo + courseInfo + dateInfo + projInfo + reqText;
    libOptions.text = stripHtml(msg + requestorInfo + courseInfo + dateInfo + projInfo + reqText);

    // Prepare email confirmation content for patron
    msg = "<p>Your request will be forwarded to the library staff member most familiar with your area of research. Staff will ";
    msg+= "be in touch with you to arrange your consultation. Below is a copy of what you submitted.</p><br>\n\n";
    userOptions.from = '"Keith Weimer" <kw6m@virginia.edu>';
    userOptions.replyTo = '"Keith Weimer" <kw6m@virginia.edu>';
    userOptions.to = requestorEmail;
    userOptions.subject = 'Your research tutorial request';
    userOptions.html = msg + requestorInfo + courseInfo + dateInfo + projInfo + reqText;
    userOptions.text = stripHtml(msg + requestorInfo + courseInfo + dateInfo + projInfo + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, researchTutorialRequestDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processStaffPurchaseRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let msg = subjPrefix = otherPerson = biblioInfo = requestorInfo = '';
    let data = { 'field_1525': reqId, 'ts_start': submitted };

    // Prepare email message body and LibInsight data parameters
    if (frmData.fld_what_is_the_purpose_of_this_request_.value) {
        msg += "<strong>" + frmData.fld_what_is_the_purpose_of_this_request_.label + ":</strong> " + frmData.fld_what_is_the_purpose_of_this_request_.value + "<br>\n";
        data['field_1482'] = frmData.fld_what_is_the_purpose_of_this_request_.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_format.value) {
        msg += "<strong>" + frmData.sect_bibliographic_information.fields.fld_format.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_format.value + "<br>\n";
        data['field_1491'] = frmData.sect_bibliographic_information.fields.fld_format.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available.value) {
        msg += "<strong>" + frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available.label + ":</strong> ";
        msg += (frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available.value === 1) ? 'Yes' : 'No';
        msg += "<br>\n";
        data['field_1522'] = (frmData.sect_bibliographic_information.fields.fld_electronic_version_preferred_when_available.value === 1) ? 'Yes' : 'No';
    }
    if (frmData.fld_is_this_a_rush_request_.value) {
        msg += "<strong>" + frmData.fld_is_this_a_rush_request_.label + ":</strong> " + frmData.fld_is_this_a_rush_request_.value + "<br>\n";
        data['field_1481'] = frmData.fld_is_this_a_rush_request_.value;
        subjPrefix = (frmData.fld_is_this_a_rush_request_.value === "Yes") ? "Rush: " : "";
    }
    msg += "<br>\n";

    // Create requestor info output content and set appropriate LibInsight fields.
    requestorInfo += "\n<h3>Requested by</h3>\n\n<p>";
    if (frmData.sect_requestor_information.fields.fld_name.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_name.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_name.value + "<br>\n";
        data['field_1489'] = frmData.sect_requestor_information.fields.fld_name.value;
    }
    if (frmData.sect_requestor_information.fields.fld_email_address.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_email_address.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_email_address.value + "<br>\n";
        data['field_1490'] = frmData.sect_requestor_information.fields.fld_email_address.value;
    }
    if (frmData.sect_requestor_information.fields.fld_uva_computing_id.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_uva_computing_id.value + "<br>\n";
        data['field_1488'] = frmData.sect_requestor_information.fields.fld_uva_computing_id.value;
    }
    if (frmData.fld_are_you_making_this_request_on_behalf_of_someone.value) {
        otherPerson += "<strong>" + frmData.fld_are_you_making_this_request_on_behalf_of_someone.label + ":</strong> " + frmData.fld_are_you_making_this_request_on_behalf_of_someone.value + "<br>\n";
        data['field_1483'] = frmData.fld_are_you_making_this_request_on_behalf_of_someone.value;
        if (frmData.fld_are_you_making_this_request_on_behalf_of_someone.value === "Yes") {
            if (frmData.fld_other_person_computing_id.value) {
                otherPerson += "<strong>" + frmData.fld_other_person_computing_id.label + ":</strong> " + frmData.fld_other_person_computing_id.value + "<br>\n";
                data['field_1484'] = frmData.fld_other_person_computing_id.value;
            }
            if (frmData.fld_other_person_department_or_school.value) {
                otherPerson += "<strong>" + frmData.fld_other_person_department_or_school.label + ":</strong> " + frmData.fld_other_person_department_or_school.value + "<br>\n";
                data['field_1485'] = frmData.fld_other_person_department_or_school.value;
                if (frmData.fld_other_person_department_or_school.value === "Other...") {
                    otherPerson += "<strong>" + frmData.fld_other_person_other_department_or_school.label + ":</strong> " + frmData.fld_other_person_other_department_or_school.value + "<br>\n";
                    data['field_1486'] = frmData.fld_other_person_other_department_or_school.value;
                }
            }
            if (frmData.fld_please_explain_why_you_are_submitting_on_someone_behalf.value) {
                otherPerson += "<strong>" + frmData.fld_please_explain_why_you_are_submitting_on_someone_behalf.label + ":</strong><br>\n" + frmData.fld_please_explain_why_you_are_submitting_on_someone_behalf.value + "<br>\n";
                data['field_1487'] = frmData.fld_please_explain_why_you_are_submitting_on_someone_behalf.value;
            }
        }
    }
    requestorInfo += "</p><br>\n";

    // Create format's bibliographic info output and set appropriate LibInsight fields.
    biblioInfo += "\n<h3>" + frmData.sect_bibliographic_information.title + "</h3>\n\n<p>";
    if (frmData.sect_bibliographic_information.fields.fld_isbn.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_isbn.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_isbn.value + "<br>\n";
        data['field_1507'] = frmData.sect_bibliographic_information.fields.fld_isbn.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_title.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_title.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_title.value + "<br>\n";
        data['field_1492'] = frmData.sect_bibliographic_information.fields.fld_title.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_name_title.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_name_title.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_name_title.value + "<br>\n";
        data['field_1493'] = frmData.sect_bibliographic_information.fields.fld_name_title.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_author_editor.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_author_editor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_author_editor.value + "<br>\n";
        data['field_1494'] = frmData.sect_bibliographic_information.fields.fld_author_editor.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_author.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_author.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_author.value + "<br>\n";
        data['field_1495'] = frmData.sect_bibliographic_information.fields.fld_author.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_director.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_director.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_director.value + "<br>\n";
        data['field_1496'] = frmData.sect_bibliographic_information.fields.fld_director.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.value + "<br>\n";
        data['field_1497'] = frmData.sect_bibliographic_information.fields.fld_composer_s_if_applicable.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_performer_s_.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_performer_s_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_performer_s_.value + "<br>\n";
        data['field_1498'] = frmData.sect_bibliographic_information.fields.fld_performer_s_.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_composer_editor.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_composer_editor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_composer_editor.value + "<br>\n";
        data['field_1499'] = frmData.sect_bibliographic_information.fields.fld_composer_editor.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_publisher.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_publisher.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_publisher.value + "<br>\n";
        data['field_1500'] = frmData.sect_bibliographic_information.fields.fld_publisher.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_music_publisher.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_music_publisher.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_music_publisher.value + "<br>\n";
        data['field_1500'] = frmData.sect_bibliographic_information.fields.fld_music_publisher.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.value + "<br>\n";
        data['field_1501'] = frmData.sect_bibliographic_information.fields.fld_creator_publisher_vendor.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_publisher_vendor.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_publisher_vendor.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_publisher_vendor.value + "<br>\n";
        data['field_1502'] = frmData.sect_bibliographic_information.fields.fld_publisher_vendor.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.value + "<br>\n";
        data['field_1503'] = frmData.sect_bibliographic_information.fields.fld_producer_publisher_creator.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.value + "<br>\n";
        data['field_1504'] = frmData.sect_bibliographic_information.fields.fld_institution_granting_degree_.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_record_label.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_record_label.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_record_label.value + "<br>\n";
        data['field_1505'] = frmData.sect_bibliographic_information.fields.fld_record_label.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_date_of_publication.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_date_of_publication.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_date_of_publication.value + "<br>\n";
        data['field_1506'] = frmData.sect_bibliographic_information.fields.fld_date_of_publication.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_release_date.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_release_date.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_release_date.value + "<br>\n";
        data['field_1508'] = frmData.sect_bibliographic_information.fields.fld_release_date.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_year_of_publication.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_year_of_publication.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_year_of_publication.value + "<br>\n";
        data['field_1509'] = frmData.sect_bibliographic_information.fields.fld_year_of_publication.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_production_date_year_only_.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_production_date_year_only_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_production_date_year_only_.value + "<br>\n";
        data['field_1510'] = frmData.sect_bibliographic_information.fields.fld_production_date_year_only_.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_edition.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_edition.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_edition.value + "<br>\n";
        data['field_1511'] = frmData.sect_bibliographic_information.fields.fld_edition.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_edition_version.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_edition_version.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_edition_version.value + "<br>\n";
        data['field_1512'] = frmData.sect_bibliographic_information.fields.fld_edition_version.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_version_info_if_applicable_.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_version_info_if_applicable_.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_version_info_if_applicable_.value + "<br>\n";
        data['field_1513'] = frmData.sect_bibliographic_information.fields.fld_version_info_if_applicable_.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not.value + "<br>\n";
        data['field_1514'] = frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_resources_do_not.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not.value + "<br>\n";
        data['field_1515'] = frmData.sect_bibliographic_information.fields.fld_what_does_this_cover_that_existing_subscriptions_do_not.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_or_students_might_use_this_journal.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_or_students_might_use_this_journal.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_or_students_might_use_this_journal.value + "<br>\n";
        data['field_1516'] = frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_or_students_might_use_this_journal.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_or_students_might_use_this_dbtrial.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_or_students_might_use_this_dbtrial.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_or_students_might_use_this_dbtrial.value + "<br>\n";
        data['field_1516'] = frmData.sect_bibliographic_information.fields.fld_what_classes_labs_faculty_or_students_might_use_this_dbtrial.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_please_describe_the_content_of_this_resource.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_please_describe_the_content_of_this_resource.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_please_describe_the_content_of_this_resource.value + "<br>\n";
        data['field_1517'] = frmData.sect_bibliographic_information.fields.fld_please_describe_the_content_of_this_resource.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_please_propose_a_journal_to_cancel.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_please_propose_a_journal_to_cancel.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_please_propose_a_journal_to_cancel.value + "<br>\n";
        data['field_1518'] = frmData.sect_bibliographic_information.fields.fld_please_propose_a_journal_to_cancel.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_how_important_is_this_resource_on_a_scale_of_1_to_5.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_how_important_is_this_resource_on_a_scale_of_1_to_5.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_how_important_is_this_resource_on_a_scale_of_1_to_5.value + "<br>\n";
        data['field_1519'] = frmData.sect_bibliographic_information.fields.fld_how_important_is_this_resource_on_a_scale_of_1_to_5.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.value + "<br>\n";
        data['field_1520'] = frmData.sect_bibliographic_information.fields.fld_location_to_purchase_url.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_price.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_price.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_price.value + "<br>\n";
        data['field_1521'] = frmData.sect_bibliographic_information.fields.fld_price.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_additional_comments.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_additional_comments.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_additional_comments.value + "<br>\n";
        data['field_1523'] = frmData.sect_bibliographic_information.fields.fld_additional_comments.value;
    }
    if (frmData.sect_bibliographic_information.fields.fld_description_comments.value) {
        biblioInfo += "<strong>" + frmData.sect_bibliographic_information.fields.fld_description_comments.label + ":</strong> " + frmData.sect_bibliographic_information.fields.fld_description_comments.value + "<br>\n";
        data['field_1524'] = frmData.sect_bibliographic_information.fields.fld_description_comments.value;
    }
    biblioInfo += "</p><br>\n";


    // Prepare email content for Library staff
    libOptions.subject = subjPrefix + 'Staff Purchase Request';
    libOptions.from = '"' + frmData.sect_requestor_information.fields.fld_name.value + '" <' + frmData.sect_requestor_information.fields.fld_email_address.value + '>';
    libOptions.replyTo = frmData.sect_requestor_information.fields.fld_email_address.value;
    // Routing varies based on format
    if (frmData.sect_bibliographic_information.fields.fld_format.value === 'Video') {
        libOptions.to = 'Libselect_video@virginia.edu';
    } else if (frmData.sect_bibliographic_information.fields.fld_format.value === 'Music Recording') {
        libOptions.to = 'lb-mu-recordings@virginia.edu';
        if (frmData.fld_is_this_a_rush_request_.value === 'Yes') { // include Acquisitions for rush request
            libOptions.to += ',lib-orders@virginia.edu';
        }
    } else if ((frmData.sect_bibliographic_information.fields.fld_format.value === 'Book') ||
            (frmData.sect_bibliographic_information.fields.fld_format.value === 'Dissertation or Thesis')) {
        libOptions.to = 'lib-collections@virginia.edu';
        if (frmData.fld_is_this_a_rush_request_.value === 'Yes') { // include Acquisitions for rush request
            libOptions.to += ',lib-orders@virginia.edu';
        }
    } else {
        // All other formats (Database/Dataset, Journal Subscription, Music Score, Trials, Other) go to LibAnswers
        libOptions.to = 'purchase-requests@virginia.libanswers.com';
        // Music scores also go to those specialists
        if (frmData.sect_bibliographic_information.fields.fld_format.value === 'Music Score') {
            libOptions.to += ',lb-mu-scores@virginia.edu';
        }
    }

    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    libOptions.html = msg + biblioInfo + requestorInfo + otherPerson + reqText;
    libOptions.text = stripHtml(msg + biblioInfo + requestorInfo + otherPerson + reqText);

    // Prepare email confirmation content for staff
    userOptions.subject = subjPrefix + 'Staff Purchase Request';
    userOptions.to = frmData.sect_requestor_information.fields.fld_email_address.value;
    userOptions.html = msg + biblioInfo + requestorInfo + otherPerson + reqText;
    userOptions.text = stripHtml(msg + biblioInfo + requestorInfo + otherPerson + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, staffPurchaseRequestDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processInternalRoomRequest(reqId, submitted, frmData, libOptions, userOptions) {
    let msg = requestorInfo = reservationInfo = preferredDateInfo = equipmentSpaceInfo = '';
    let data = { 'field_1426': reqId, 'ts_start': submitted };

    // Prepare email message body and LibInsight data parameters
    requestorInfo += "\n<h3>" + frmData.sect_requestor_information.title + "</h3>\n\n<p>";
    if (frmData.sect_requestor_information.fields.fld_uva_computing_id.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_uva_computing_id.value + "<br>\n";
        data['field_1409'] = frmData.sect_requestor_information.fields.fld_uva_computing_id.value;
    }
    if (frmData.sect_requestor_information.fields.fld_name.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_name.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_name.value + "<br>\n";
        data['field_1410'] = frmData.sect_requestor_information.fields.fld_name.value;
    }
    if (frmData.sect_requestor_information.fields.fld_email_address.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_email_address.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_email_address.value + "<br>\n";
        data['field_1411'] = frmData.sect_requestor_information.fields.fld_email_address.value;
    }
    if (frmData.sect_requestor_information.fields.fld_phone_number.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_phone_number.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_phone_number.value + "<br>\n";
        data['field_1412'] = frmData.sect_requestor_information.fields.fld_phone_number.value;
    }
    if (frmData.sect_requestor_information.fields.fld_requesting_on_behalf_of_area_department.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_requesting_on_behalf_of_area_department.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_requesting_on_behalf_of_area_department.value + "<br>\n";
        data['field_1413'] = frmData.sect_requestor_information.fields.fld_requesting_on_behalf_of_area_department.value;
    }
    requestorInfo += "</p><br>\n";

    reservationInfo += "\n<h3>" + frmData.sect_reservation_information.title + "</h3>\n\n<p>";
    if (frmData.sect_reservation_information.fields.fld_title.value) {
        reservationInfo += "<strong>" + frmData.sect_reservation_information.fields.fld_title.label + ":</strong> " + frmData.sect_reservation_information.fields.fld_title.value + "<br>\n";
        data['field_1414'] = frmData.sect_reservation_information.fields.fld_title.value;
    }
    if (frmData.sect_reservation_information.fields.fld_type.value) {
        reservationInfo += "<strong>" + frmData.sect_reservation_information.fields.fld_type.label + ":</strong> " + frmData.sect_reservation_information.fields.fld_type.value + "<br>\n";
        data['field_1415'] = frmData.sect_reservation_information.fields.fld_type.value;
    }
    if (frmData.sect_reservation_information.fields.fld_description.value) {
        reservationInfo += "<strong>" + frmData.sect_reservation_information.fields.fld_description.label + ":</strong> " + frmData.sect_reservation_information.fields.fld_description.value + "<br>\n";
        data['field_1416'] = frmData.sect_reservation_information.fields.fld_description.value;
    }
    if (frmData.sect_reservation_information.fields.fld_number_of_attendees.value) {
        reservationInfo += "<strong>" + frmData.sect_reservation_information.fields.fld_number_of_attendees.label + ":</strong> " + frmData.sect_reservation_information.fields.fld_number_of_attendees.value + "<br>\n";
        data['field_1417'] = frmData.sect_reservation_information.fields.fld_number_of_attendees.value;
    }
    if (!isObjectEmpty(frmData.sect_reservation_information.fields.fld_target_audience.value)) {
        reservationInfo += "<strong>" + frmData.sect_reservation_information.fields.fld_target_audience.label + "</strong><br>\n";
        reservationInfo += "<ul>";
        for (let key in frmData.sect_reservation_information.fields.fld_target_audience.value) {
            reservationInfo += "<li>" + frmData.sect_reservation_information.fields.fld_target_audience.value[key] + "</li>\n";
        }
        reservationInfo += "</ul><br>\n";
        data['field_1418'] = Object.keys(frmData.sect_reservation_information.fields.fld_target_audience.value).join(', ');
    }
    reservationInfo += "</p><br>\n";

    preferredDateInfo += "\n<h3>" + frmData.sect_preferred_date_of_event.title + "</h3>\n\n<p>";
    if (frmData.sect_preferred_date_of_event.fields.fld_first_and_second_choices.value.sessionDateTime && frmData.sect_preferred_date_of_event.fields.fld_first_and_second_choices.value.sessionDateTime.length > 0) {
        for (let i=0; i < frmData.sect_preferred_date_of_event.fields.fld_first_and_second_choices.value.sessionDateTime.length; i++) {
            const choice = frmData.sect_preferred_date_of_event.fields.fld_first_and_second_choices.value.sessionDateTime[i];
            let choiceStr = choiceDateTimeToString(choice);
            preferredDateInfo += choiceStr;
            if (choice.nth === 1) {
                data['field_1419'] = stripHtml(choiceStr);
            } else {
                data['field_1420'] = stripHtml(choiceStr);
            }
        }
    }
    preferredDateInfo += "</p><br>\n";

    equipmentSpaceInfo += "\n<h3>" + frmData.sect_equipment_and_room.title + "</h3>\n\n<p>";
    if (!isObjectEmpty(frmData.sect_equipment_and_room.fields.fld_equipment.value)) {
        equipmentSpaceInfo += "<strong>" + frmData.sect_equipment_and_room.fields.fld_equipment.label + "</strong><br>\n";
        equipmentSpaceInfo += "<ul>";
        for (let key in frmData.sect_equipment_and_room.fields.fld_equipment.value) {
            equipmentSpaceInfo += "<li>" + frmData.sect_equipment_and_room.fields.fld_equipment.value[key] + "</li>\n";
        }
        equipmentSpaceInfo += "</ul><br>\n";
        data['field_1421'] = Object.keys(frmData.sect_equipment_and_room.fields.fld_equipment.value).join(', ');
        if (frmData.sect_equipment_and_room.fields.fld_equipment.value.hasOwnProperty("Other")) {
            if (frmData.sect_equipment_and_room.fields.fld_other_equipment.value) {
                equipmentSpaceInfo += "<strong>" + frmData.sect_equipment_and_room.fields.fld_other_equipment.label + "</strong><br>\n" + frmData.sect_equipment_and_room.fields.fld_other_equipment.value + "<br>\n";
                data['field_1422'] = frmData.sect_equipment_and_room.fields.fld_other_equipment.value;
            }
        }
    }
    if (frmData.sect_equipment_and_room.fields.fld_room.value) {
        equipmentSpaceInfo += "<strong>" + frmData.sect_equipment_and_room.fields.fld_room.label + ":</strong> " + frmData.sect_equipment_and_room.fields.fld_room.value + "<br>\n";
        data['field_1423'] = frmData.sect_equipment_and_room.fields.fld_room.value;
    }
    if (frmData.sect_equipment_and_room.fields.fld_catering.value) {
        equipmentSpaceInfo += "<strong>" + frmData.sect_equipment_and_room.fields.fld_catering.label + ":</strong> " + frmData.sect_equipment_and_room.fields.fld_catering.value + "<br>\n";
        data['field_1424'] = frmData.sect_equipment_and_room.fields.fld_catering.value;
    }
    equipmentSpaceInfo += "</p><br>\n";

    if (frmData.fld_questions_comments.value) {
        msg += "<strong>" + frmData.fld_questions_comments.label + ":</strong> " + frmData.fld_questions_comments.value + "<br>\n";
        data['field_1425'] = frmData.fld_questions_comments.value;
    }

    // Prepare email content for Events team
    libOptions.subject += 'Internal Request for Library Classroom';
    libOptions.from = '"' + frmData.sect_requestor_information.fields.fld_name.value + '" <' + frmData.sect_requestor_information.fields.fld_email_address.value + '>';
    libOptions.replyTo = frmData.sect_requestor_information.fields.fld_email_address.value;
    libOptions.to = 'libevents@virginia.edu'
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    libOptions.html = requestorInfo + reservationInfo + preferredDateInfo + equipmentSpaceInfo + msg + reqText;
    libOptions.text = stripHtml(requestorInfo + reservationInfo + preferredDateInfo + equipmentSpaceInfo + msg + reqText);

    // Prepare email confirmation content for staff
    userOptions.subject += 'Internal Request for Library Classroom';
    userOptions.from = '"A&P Events Team" <libevents@virginia.edu>';
    userOptions.to = frmData.sect_requestor_information.fields.fld_email_address.value;
    userOptions.html = requestorInfo + reservationInfo + preferredDateInfo + equipmentSpaceInfo + msg + reqText;
    userOptions.text = stripHtml(requestorInfo + reservationInfo + preferredDateInfo + equipmentSpaceInfo + msg + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, internalRoomRequestDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processReportLibraryIncident(reqId, submitted, frmData, libOptions, userOptions) {
    let msg = incidentInfo = suspectInfo = victimInfo = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;

    // Prepare email message body and LibInsight data parameters
    incidentInfo += "\n<h3>" + frmData.sect_incident.title + "</h3>\n\n<p>";
    console.log(frmData.sect_incident.fields.fld_date_and_time_of_incident.value);
    if (frmData.sect_incident.fields.fld_date_and_time_of_incident.value.date && frmData.sect_incident.fields.fld_date_and_time_of_incident.value.startTime) {
        incidentInfo += "<strong>" + frmData.sect_incident.fields.fld_date_and_time_of_incident.label + ":</strong> ";
        incidentInfo += convDateYMDtoMDY(frmData.sect_incident.fields.fld_date_and_time_of_incident.value.date) + " ";
        incidentInfo += convTime24to12(frmData.sect_incident.fields.fld_date_and_time_of_incident.value.startTime) + "<br>\n";
    }
    if (frmData.sect_incident.fields.fld_exact_library_floor.value) {
        incidentInfo += "<strong>" + frmData.sect_incident.fields.fld_exact_library_floor.label + ":</strong> " + frmData.sect_incident.fields.fld_exact_library_floor.value + "<br>\n";
    }
    if (frmData.sect_incident.fields.fld_reported_to.value) {
        incidentInfo += "<strong>" + frmData.sect_incident.fields.fld_reported_to.label + ":</strong> " + frmData.sect_incident.fields.fld_reported_to.value + "<br>\n";
    }
    if (frmData.sect_incident.fields.fld_u_va_police_contacted.value) {
        incidentInfo += "<strong>" + frmData.sect_incident.fields.fld_u_va_police_contacted.label + ":</strong> " + frmData.sect_incident.fields.fld_u_va_police_contacted.value + "<br>\n";
    }
    if (frmData.sect_incident.fields.fld_nature_of_the_offense.value) {
        incidentInfo += "<strong>" + frmData.sect_incident.fields.fld_nature_of_the_offense.label + ":</strong> " + frmData.sect_incident.fields.fld_nature_of_the_offense.value + "<br>\n";
    }
    incidentInfo += "</p><br>\n";
    suspectInfo += "\n<h3>" + frmData.sect_description_of_suspect.title + "</h3>\n\n<p>";
    if (frmData.sect_description_of_suspect.fields.fld_suspect_name.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_suspect_name.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_suspect_name.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_gender.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_gender.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_gender.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_race.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_race.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_race.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_age.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_age.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_age.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_build.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_build.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_build.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_height.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_height.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_height.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_weight.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_weight.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_weight.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_skin.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_skin.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_skin.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_eyes.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_eyes.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_eyes.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_hair_color.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_hair_color.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_hair_color.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_hair_length.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_hair_length.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_hair_length.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_hair_style.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_hair_style.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_hair_style.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_facial_hair.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_facial_hair.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_facial_hair.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_suspect_may_be.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_suspect_may_be.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_suspect_may_be.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_distinguishing_features.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_distinguishing_features.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_distinguishing_features.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_voice_speech_.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_voice_speech_.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_voice_speech_.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_hat.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_hat.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_hat.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_coat_jacket_sweater.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_coat_jacket_sweater.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_coat_jacket_sweater.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_blouse_shirt.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_blouse_shirt.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_blouse_shirt.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_shoes.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_shoes.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_shoes.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_jewelry.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_jewelry.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_jewelry.value + "<br>\n";
    }
    if (frmData.sect_description_of_suspect.fields.fld_additional_information.value) {
        suspectInfo += "<strong>" + frmData.sect_description_of_suspect.fields.fld_additional_information.label + ":</strong> " + frmData.sect_description_of_suspect.fields.fld_additional_information.value + "<br>\n";
    }
    suspectInfo += "</p><br>\n";
    victimInfo += "\n<h3>" + frmData.sect_victim_information.title + "</h3>\n\n<p>";
    if (frmData.sect_victim_information.fields.fld_u_va_computing_id.value) {
        victimInfo += "<strong>" + frmData.sect_victim_information.fields.fld_u_va_computing_id.label + ":</strong> " + frmData.sect_victim_information.fields.fld_u_va_computing_id.value + "<br>\n";
    }
    if (frmData.sect_victim_information.fields.fld_name.value) {
        victimInfo += "<strong>" + frmData.sect_victim_information.fields.fld_name.label + ":</strong> " + frmData.sect_victim_information.fields.fld_name.value + "<br>\n";
    }
    if (frmData.sect_victim_information.fields.fld_email_address.value) {
        victimInfo += "<strong>" + frmData.sect_victim_information.fields.fld_email_address.label + ":</strong> " + frmData.sect_victim_information.fields.fld_email_address.value + "<br>\n";
    }
    if (frmData.sect_victim_information.fields.fld_phone.value) {
        victimInfo += "<strong>" + frmData.sect_victim_information.fields.fld_phone.label + ":</strong> " + frmData.sect_victim_information.fields.fld_phone.value + "<br>\n";
    }
    if (frmData.sect_victim_information.fields.fld_reporter_s_computing_id.value) {
        victimInfo += "<strong>" + frmData.sect_victim_information.fields.fld_reporter_s_computing_id.label + ":</strong> " + frmData.sect_victim_information.fields.fld_reporter_s_computing_id.value + "<br>\n";
    }
    if (frmData.sect_victim_information.fields.fld_reporter_s_name.value) {
        victimInfo += "<strong>" + frmData.sect_victim_information.fields.fld_reporter_s_name.label + ":</strong> " + frmData.sect_victim_information.fields.fld_reporter_s_name.value + "<br>\n";
    }
    if (frmData.sect_victim_information.fields.fld_reporter_email.value) {
        victimInfo += "<strong>" + frmData.sect_victim_information.fields.fld_reporter_email.label + ":</strong> " + frmData.sect_victim_information.fields.fld_reporter_email.value + "<br>\n";
    }
    victimInfo += "<strong>Reported at:</strong> " + submitted + "<br>\n";
    victimInfo += "</p><br>\n";

    // Prepare email content for Library staff
    libOptions.from = frmData.sect_victim_information.fields.fld_reporter_email.value;
    libOptions.replyTo = frmData.sect_victim_information.fields.fld_reporter_email.value;
    libOptions.to = 'Lib-Incidents@virginia.edu';
    libOptions.subject = 'Library Incident Report';
    libOptions.html = incidentInfo + suspectInfo + victimInfo + reqText;
    libOptions.text = stripHtml(incidentInfo + suspectInfo + victimInfo + reqText);

    // Prepare email confirmation content for patron
    msg = "<p>A copy of the incident you reported for your records.</p><br>\n\n";
    userOptions.to = frmData.sect_victim_information.fields.fld_reporter_email.value;
    userOptions.subject = 'Library incident reported by you';
    userOptions.html = msg + incidentInfo + suspectInfo + victimInfo + reqText;
    userOptions.text = stripHtml(msg + incidentInfo + suspectInfo + victimInfo + reqText);

    try {
        return postEmailOnly(reqId, libOptions, userOptions);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processRequestEventSpace(reqId, submitted, frmData, libOptions, userOptions) {
    let inputs = contactInfo = eventInfo = msg = '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let data = { 'field_1590': reqId, 'ts_start': submitted };

    // Prepare email message body and LibInsight data parameters
    contactInfo += "\n<h3>" + frmData.sect_contact_information.title + "</h3>\n\n<p>";
    if (frmData.sect_contact_information.fields.fld_name.value) {
        contactInfo += "<strong>" + frmData.sect_contact_information.fields.fld_name.label + ":</strong> " + frmData.sect_contact_information.fields.fld_name.value + "<br>\n";
        data['field_1565'] = frmData.sect_contact_information.fields.fld_name.value;
    }
    if (frmData.sect_contact_information.fields.fld_email.value) {
        contactInfo += "<strong>" + frmData.sect_contact_information.fields.fld_email.label + ":</strong> " + frmData.sect_contact_information.fields.fld_email.value + "<br>\n";
        data['field_1566'] = frmData.sect_contact_information.fields.fld_email.value;
    }
    if (frmData.sect_contact_information.fields.fld_phone.value) {
        contactInfo += "<strong>" + frmData.sect_contact_information.fields.fld_phone.label + ":</strong> " + frmData.sect_contact_information.fields.fld_phone.value + "<br>\n";
        data['field_1567'] = frmData.sect_contact_information.fields.fld_phone.value;
    }
    if (frmData.sect_contact_information.fields.fld_affiliation.value) {
        contactInfo += "<strong>" + frmData.sect_contact_information.fields.fld_affiliation.label + ":</strong> " + frmData.sect_contact_information.fields.fld_affiliation.value + "<br>\n";
        data['field_1568'] = frmData.sect_contact_information.fields.fld_affiliation.value;
    }
    if (frmData.sect_contact_information.fields.fld_website.value) {
        contactInfo += "<strong>" + frmData.sect_contact_information.fields.fld_website.label + ":</strong> " + frmData.sect_contact_information.fields.fld_website.value + "<br>\n";
        data['field_1569'] = frmData.sect_contact_information.fields.fld_website.value;
    }
    contactInfo += "</p><br>\n";
    eventInfo += "\n<h3>" + frmData.sect_event_information.title + "</h3>\n\n<p>";
    if (frmData.sect_event_information.fields.fld_title_of_event.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_title_of_event.label + ":</strong> " + frmData.sect_event_information.fields.fld_title_of_event.value + "<br>\n";
        data['field_1570'] = frmData.sect_event_information.fields.fld_title_of_event.value;
    }
    if (frmData.sect_event_information.fields.fld_type.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_type.label + ":</strong> " + frmData.sect_event_information.fields.fld_type.value + "<br>\n";
        data['field_1571'] = frmData.sect_event_information.fields.fld_type.value;
    }
    if (frmData.sect_event_information.fields.fld_description.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_description.label + ":</strong> " + frmData.sect_event_information.fields.fld_description.value + "<br>\n";
        data['field_1572'] = frmData.sect_event_information.fields.fld_description.value;
    }
    if (frmData.sect_event_information.fields.fld_will_this_event.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_will_this_event.label + ":</strong> " + frmData.sect_event_information.fields.fld_will_this_event.value + "<br>\n";
        data['field_1573'] = frmData.sect_event_information.fields.fld_will_this_event.value;
    }
    if (frmData.sect_event_information.fields.fld_do_you_have_a_copy.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_do_you_have_a_copy.label + ":</strong> " + frmData.sect_event_information.fields.fld_do_you_have_a_copy.value + "<br>\n";
        data['field_1574'] = frmData.sect_event_information.fields.fld_do_you_have_a_copy.value;
    }
    if (frmData.sect_event_information.fields.fld_do_you_have_a_copy.value && (frmData.sect_event_information.fields.fld_do_you_have_a_copy.value === 'Yes')) {
        if (frmData.sect_event_information.fields.fld_program_url.value) {
            eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_program_url.label + ":</strong> " + frmData.sect_event_information.fields.fld_program_url.value + "<br>\n";
            data['field_1575'] = frmData.sect_event_information.fields.fld_program_url.value;
        }
    }
    if (frmData.sect_event_information.fields.fld_do_you_have_a_copy.value && (frmData.sect_event_information.fields.fld_do_you_have_a_copy.value === 'No, have file')) {
        if (frmData.sect_event_information.fields.fld_attach_program.value && (frmData.sect_event_information.fields.fld_attach_program.value.fids.length > 0)) {
            const firebaseFilename = (frmData.sect_event_information.fields.fld_attach_program.value.fids.length > 0) ? frmData.sect_event_information.fields.fld_attach_program.value.fids[0] : '';
            if (firebaseFilename !== "") {
                libOptions.attach_type = userOptions.attach_type = (frmData.sect_event_information.fields.fld_attach_program.email_type) ? frmData.sect_event_information.fields.fld_attach_program.email_type : 'attach';
                libOptions.sourceFile = userOptions.sourceFile = firebaseFilename;
                libOptions.destFile = userOptions.destFile = firebaseFilename.substring(firebaseFilename.indexOf('_')+1);
                eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_attach_program.label + " file name</strong><br>\n" + libOptions.destFile + "<br>\n";
                data['field_1576'] = firebaseFilename; // since this file is saved and linked to, use the firebase filename in LibInsight
            }
        }
    }
    if (frmData.sect_event_information.fields.fld_expected_number_of_attendees.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_expected_number_of_attendees.label + ":</strong> " + frmData.sect_event_information.fields.fld_expected_number_of_attendees.value + "<br>\n";
        data['field_1577'] = frmData.sect_event_information.fields.fld_expected_number_of_attendees.value;
    }
    if (!isObjectEmpty(frmData.sect_event_information.fields.fld_target_audience.value)) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_target_audience.label + "</strong><br>\n";
        eventInfo += "<ul>";
        for (let key in frmData.sect_event_information.fields.fld_target_audience.value) {
            eventInfo += "<li>" + frmData.sect_event_information.fields.fld_target_audience.value[key] + "</li>\n";
        }
        eventInfo += "</ul><br>\n";
        data['field_1578'] = Object.keys(frmData.sect_event_information.fields.fld_target_audience.value).join(', ');
    }
    if (frmData.sect_event_information.fields.fld_are_you_expecting_minors.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_are_you_expecting_minors.label + ":</strong> " + frmData.sect_event_information.fields.fld_are_you_expecting_minors.value + "<br>\n";
        data['field_1579'] = frmData.sect_event_information.fields.fld_are_you_expecting_minors.value;
    }
    if (frmData.sect_event_information.fields.fld_preferred_date_of_event.value.sessionDateTime && frmData.sect_event_information.fields.fld_preferred_date_of_event.value.sessionDateTime.length > 0) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_preferred_date_of_event.label + ":</strong><br>\n";
        let preferredDate = '';
        for (let i=0; i < frmData.sect_event_information.fields.fld_preferred_date_of_event.value.sessionDateTime.length; i++) {
            const choice = frmData.sect_event_information.fields.fld_preferred_date_of_event.value.sessionDateTime[i];
            let choiceStr = choiceDateTimeToString(choice);
            eventInfo += choiceStr;
            preferredDate += choiceStr;
        }
        data['field_1580'] = stripHtml(preferredDate);
    }
    if (!isObjectEmpty(frmData.sect_event_information.fields.fld_auditorium_a_v_needs.value)) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_auditorium_a_v_needs.label + "</strong><br>\n";
        eventInfo += "<ul>";
        for (let key in frmData.sect_event_information.fields.fld_auditorium_a_v_needs.value) {
            eventInfo += "<li>" + frmData.sect_event_information.fields.fld_auditorium_a_v_needs.value[key] + "</li>\n";
        }
        eventInfo += "</ul><br>\n";
        data['field_1582'] = Object.keys(frmData.sect_event_information.fields.fld_auditorium_a_v_needs.value).join(', ');
    }
    if (frmData.sect_event_information.fields.fld_auditorium_requested_room_layout.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_auditorium_requested_room_layout.label + ":</strong> " + frmData.sect_event_information.fields.fld_auditorium_requested_room_layout.value + "<br>\n";
        data['field_1583'] = frmData.sect_event_information.fields.fld_auditorium_requested_room_layout.value;
        if (frmData.sect_event_information.fields.fld_auditorium_requested_room_layout.value === 'Other...') {
            if (frmData.sect_event_information.fields.fld_other_room_layout_description.value) {
                eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_other_room_layout_description.label + ":</strong> " + frmData.sect_event_information.fields.fld_other_room_layout_description.value + "<br>\n";
                data['field_1584'] = frmData.sect_event_information.fields.fld_other_room_layout_description.value;
            }
        }
    }
    if (frmData.sect_event_information.fields.fld_catering_food.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_catering_food.label + ":</strong> " + frmData.sect_event_information.fields.fld_catering_food.value + "<br>\n";
        data['field_1585'] = frmData.sect_event_information.fields.fld_catering_food.value;
        if (frmData.sect_event_information.fields.fld_catering_food.value !== 'No catering/food') {
            if (frmData.sect_event_information.fields.fld_name_of_caterer.value) {
                eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_name_of_caterer.label + ":</strong> " + frmData.sect_event_information.fields.fld_name_of_caterer.value + "<br>\n";
                data['field_1586'] = frmData.sect_event_information.fields.fld_name_of_caterer.value;
            }
        }
    }
    if (frmData.sect_event_information.fields.fld_payment_method.value) {
        eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_payment_method.label + ":</strong> " + frmData.sect_event_information.fields.fld_payment_method.value + "<br>\n";
        data['field_1587'] = frmData.sect_event_information.fields.fld_payment_method.value;
        if (frmData.sect_event_information.fields.fld_payment_method.value === 'PTAO') {
            if (frmData.sect_event_information.fields.fld_ptao.value) {
                eventInfo += "<strong>" + frmData.sect_event_information.fields.fld_ptao.label + ":</strong> " + frmData.sect_event_information.fields.fld_ptao.value + "<br>\n";
                data['field_1588'] = frmData.sect_event_information.fields.fld_ptao.value;
            }
        }
    }
    eventInfo += "</p><br>\n";

    if (frmData.fld_additional_information.value) {
        inputs += "<br>\n<strong>" + frmData.fld_additional_information.label + "</strong>" + frmData.fld_additional_information.value + "</p><br>\n";
        data['field_1589'] = frmData.fld_additional_information.value;
    }
    if (frmData.fld_event_space.value) {
        data['field_1581'] = frmData.fld_event_space.value;
    }
    msg = "<p>* This email may contain an attachment. It is recommended that you scan any attachment to make sure it does not contain a virus.<br>\n"
    msg += "<br>\nBelow is a new event space request.</p><br>\n\n";

    // Prepare email content for Library staff
    libOptions.from = frmData.sect_contact_information.fields.fld_email.value;
    libOptions.replyTo = frmData.sect_contact_information.fields.fld_email.value;
    // @TODO Routing goes to Events team in production.
    libOptions.to = 'jlk4p@virginia.edu'; //'jmf6a@virginia.edu,mhm8m@virginia.edu,dlg7y@virginia.edu';
    libOptions.subject = 'Harrison Event Space Request';
    libOptions.html = msg + contactInfo + eventInfo + inputs + reqText;
    libOptions.text = stripHtml(msg + contactInfo + eventInfo + inputs + reqText);

    // Prepare email confirmation content for patron
    msg = "<p>Your request has been submitted.  Please allow two business days for a response regarding availability and the status of your request.</p><br>\n\n";
    userOptions.from = '"UVA Harrison Institute" <libevents@virginia.edu>';
    userOptions.replyTo = '"UVA Harrison Institute" <libevents@virginia.edu>';
    userOptions.to = frmData.sect_contact_information.fields.fld_email.value;
    userOptions.subject = 'Harrison Event Space Request';
    userOptions.html = msg + contactInfo + eventInfo + inputs + reqText;
    userOptions.text = stripHtml(msg + contactInfo + eventInfo + inputs + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, requestEventSpaceDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processRequestZoomRoom(reqId, submitted, frmData, libOptions, userOptions) {
    let requestorInfo = meetingInfo = courseInfo = reservationInfo = roomInfo = commentInfo = msg = inputs= '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let data = { 'field_1623': reqId, 'ts_start': submitted };

    if (frmData.fld_is_this_request_for_a_course_or_a_meeting.value) {
        inputs += "<p><strong>" + frmData.fld_is_this_request_for_a_course_or_a_meeting.label + ":</strong> " + frmData.fld_is_this_request_for_a_course_or_a_meeting.value + "</p><br>\n";
        data['field_1600'] = frmData.fld_is_this_request_for_a_course_or_a_meeting.value;
    }
    if (frmData.fld_is_this_request_for_a_course_or_a_meeting.value && frmData.fld_is_this_request_for_a_course_or_a_meeting.value === 'Meeting') {
        meetingInfo += "\n<h3>" + frmData.sect_meeting_information.title + "</h3>\n\n<p>";
        if (frmData.sect_meeting_information.fields.fld_meeting_title.value) {
            meetingInfo += "<strong>" + frmData.sect_meeting_information.fields.fld_meeting_title.label + ":</strong> " + frmData.sect_meeting_information.fields.fld_meeting_title.value + "<br>\n";
            data['field_1601'] = frmData.sect_meeting_information.fields.fld_meeting_title.value;
        }
        if (frmData.sect_meeting_information.fields.fld_meeting_description.value) {
            meetingInfo += "<strong>" + frmData.sect_meeting_information.fields.fld_meeting_description.label + ":</strong> " + frmData.sect_meeting_information.fields.fld_meeting_description.value + "<br>\n";
            data['field_1602'] = frmData.sect_meeting_information.fields.fld_meeting_description.value;
        }
        meetingInfo += "</p><br>\n";
    }
    if (frmData.fld_is_this_request_for_a_course_or_a_meeting.value && frmData.fld_is_this_request_for_a_course_or_a_meeting.value === 'Course') {
        courseInfo += "\n<h3>" + frmData.sect_course_information.title + "</h3>\n\n<p>";
        if (frmData.sect_course_information.fields.fld_course_section_selector.value) {
            if (frmData.sect_course_information.fields.fld_course_section_selector.value.term) {
                courseInfo += "<strong>Term:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.term + "<br>\n";
                data['field_1603'] = frmData.sect_course_information.fields.fld_course_section_selector.value.term;
            }
            if (frmData.sect_course_information.fields.fld_course_section_selector.value.course) {
                courseInfo += "<strong>Course:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.course + "<br>\n";
                data['field_1604'] = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
                courseNum = frmData.sect_course_information.fields.fld_course_section_selector.value.course;
            }
            if (frmData.sect_course_information.fields.fld_course_section_selector.value.section) {
                courseInfo += "<strong>Section:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.section + "<br>\n";
                data['field_1605'] = frmData.sect_course_information.fields.fld_course_section_selector.value.section;
            }
            if (frmData.sect_course_information.fields.fld_course_section_selector.value.title) {
                courseInfo += "<strong>Title:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.title + "<br>\n";
                data['field_1606'] = frmData.sect_course_information.fields.fld_course_section_selector.value.title;
            }
            if (frmData.sect_course_information.fields.fld_course_section_selector.value.meetingTime) {
                courseInfo += "<strong>Meeting time:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.meetingTime + "<br>\n";
                data['field_1607'] = frmData.sect_course_information.fields.fld_course_section_selector.value.meetingTime;
            }
            if (frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment) {
                courseInfo += "<strong>Enrollment:</strong> " + frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment + "<br>\n";
                data['field_1608'] = frmData.sect_course_information.fields.fld_course_section_selector.value.enrollment;
            }
        }
        courseInfo += "</p><br>\n";
    }
    reservationInfo += "\n<h3>"+frmData.sect_reservation_dates_times.title+"</h3>\n\n";
    if (frmData.sect_reservation_dates_times.fields.fld_preferred_dates.value.data && frmData.sect_reservation_dates_times.fields.fld_preferred_dates.value.data.length > 0) {
        for (let i=0; i < frmData.sect_reservation_dates_times.fields.fld_preferred_dates.value.data.length; i++) {
            const session = frmData.sect_reservation_dates_times.fields.fld_preferred_dates.value.data[i];
            if (session.show) {
                const sessionText = sessionLengthAndChoicesToString(session);
                reservationInfo += sessionText + "<hr>";
                if (session.nth === 1) {
                    data['field_1609'] = stripHtml(sessionText);
                } else if (session.nth === 2) {
                    data['field_1610'] = stripHtml(sessionText);
                } else {
                    data['field_1611'] = stripHtml(sessionText);
                }
            }
        }
    }
    reservationInfo += "<br>\n";
    roomInfo += "\n<h3>"+frmData.sect_room_usage.title+"</h3>\n\n";
    if (frmData.sect_room_usage.fields.fld_location_room.value) {
        roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_location_room.label + ":</strong> " + frmData.sect_room_usage.fields.fld_location_room.value + "<br>\n";
        data['field_1612'] = frmData.sect_room_usage.fields.fld_location_room.value;
    }
    if (frmData.sect_room_usage.fields.fld_will_you_use_the_equipment.value) {
        roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_will_you_use_the_equipment.label + ":</strong> " + frmData.sect_room_usage.fields.fld_will_you_use_the_equipment.value + "<br>\n";
        data['field_1613'] = frmData.sect_room_usage.fields.fld_will_you_use_the_equipment.value;
    }
    if (frmData.sect_room_usage.fields.fld_number_of_attendees.value) {
        roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_number_of_attendees.label + ":</strong> " + frmData.sect_room_usage.fields.fld_number_of_attendees.value + "<br>\n";
        data['field_1614'] = frmData.sect_room_usage.fields.fld_number_of_attendees.value;
    }
    if (frmData.sect_room_usage.fields.fld_will_you_use_the_equipment.value && frmData.sect_room_usage.fields.fld_will_you_use_the_equipment.value === 'Yes') {
        if (!isObjectEmpty(frmData.sect_room_usage.fields.fld_who_is_participating.value)) {
            roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_who_is_participating.label + ":</strong> <br>\n";
            roomInfo += "<ul>";
            for (let key in frmData.sect_room_usage.fields.fld_who_is_participating.value) {
                roomInfo += "<li>" + frmData.sect_room_usage.fields.fld_who_is_participating.value[key] + "</li>\n";
            }
            roomInfo += "</ul><br>\n";
            data['field_1615'] = Object.keys(frmData.sect_room_usage.fields.fld_who_is_participating.value).join(', ');
            if (frmData.sect_room_usage.fields.fld_who_is_participating.value.hasOwnProperty("Other...")) {
                roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_other_participants.label + ":</strong> " + frmData.sect_room_usage.fields.fld_other_participants.value + "<br>\n";
                data['field_1616'] = frmData.sect_room_usage.fields.fld_other_participants.value;
            }
        }
        if (frmData.sect_room_usage.fields.fld_who_is_hosting_this.value) {
            roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_who_is_hosting_this.label + ":</strong> " + frmData.sect_room_usage.fields.fld_who_is_hosting_this.value + "<br>\n";
            data['field_1617'] = frmData.sect_room_usage.fields.fld_who_is_hosting_this.value;
        }
        if (frmData.sect_room_usage.fields.fld_who_is_hosting_this.value === 'Other...') {
            if (frmData.sect_room_usage.fields.fld_other_institution_hosting.value) {
                roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_other_institution_hosting.label + ":</strong> " + frmData.sect_room_usage.fields.fld_other_institution_hosting.value + "<br>\n";
                data['field_1618'] = frmData.sect_room_usage.fields.fld_other_institution_hosting.value;
            }
        }
        if (frmData.sect_room_usage.fields.fld_do_you_anticipate_needing_help.value) {
            roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_do_you_anticipate_needing_help.label + ":</strong> " + frmData.sect_room_usage.fields.fld_do_you_anticipate_needing_help.value + "<br>\n";
            data['field_1619'] = frmData.sect_room_usage.fields.fld_do_you_anticipate_needing_help.value;
        }
        if (frmData.sect_room_usage.fields.fld_pre_event_access_needs.value) {
            roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_pre_event_access_needs.label + ":</strong> " + frmData.sect_room_usage.fields.fld_pre_event_access_needs.value + "<br>\n";
            data['field_1620'] = frmData.sect_room_usage.fields.fld_pre_event_access_needs.value;
        }
        if (frmData.sect_room_usage.fields.fld_post_event_access_needs.value) {
            roomInfo += "<strong>" + frmData.sect_room_usage.fields.fld_post_event_access_needs.label + ":</strong> " + frmData.sect_room_usage.fields.fld_post_event_access_needs.value + "<br>\n";
            data['field_1621'] = frmData.sect_room_usage.fields.fld_post_event_access_needs.value;
        }
    }
    roomInfo += "<br>\n";
    commentInfo += "\n<h3>" + frmData.sect_comments.title + "</h3>\n\n<p>";
    if (frmData.sect_comments.fields.fld_provide_any_additional_information.value) {
        commentInfo += "<strong>" + frmData.sect_comments.fields.fld_provide_any_additional_information.label + ":</strong> " + frmData.sect_comments.fields.fld_provide_any_additional_information.value + "<br>\n";
        data['field_1622'] = frmData.sect_comments.fields.fld_provide_any_additional_information.value;
    }
    commentInfo += "</p><br>\n";
    requestorInfo += "\n<h3>" + frmData.sect_requestor_information.title + "</h3>\n\n<p>";
    if (frmData.sect_requestor_information.fields.fld_uva_computing_id.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_uva_computing_id.value + "<br>\n";
        data['field_1593'] = frmData.sect_requestor_information.fields.fld_uva_computing_id.value;
    }
    if (frmData.sect_requestor_information.fields.fld_name.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_name.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_name.value + "<br>\n";
        data['field_1594'] = frmData.sect_requestor_information.fields.fld_name.value;
    }
    if (frmData.sect_requestor_information.fields.fld_email_address.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_email_address.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_email_address.value + "<br>\n";
        data['field_1595'] = frmData.sect_requestor_information.fields.fld_email_address.value;
    }
    if (frmData.sect_requestor_information.fields.fld_phone_number.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_phone_number.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_phone_number.value + "<br>\n";
        data['field_1596'] = frmData.sect_requestor_information.fields.fld_phone_number.value;
    }
    if (frmData.sect_requestor_information.fields.fld_university_affiliation.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_affiliation.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_affiliation.value + "<br>\n";
        data['field_1597'] = frmData.sect_requestor_information.fields.fld_university_affiliation.value;
    }
    if (frmData.sect_requestor_information.fields.fld_university_department_or_school.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_university_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_university_department_or_school.value + "<br>\n";
        data['field_1598'] = frmData.sect_requestor_information.fields.fld_university_department_or_school.value;
        if (frmData.sect_requestor_information.fields.fld_university_department_or_school.value === 'Other...') {
            if (frmData.sect_requestor_information.fields.fld_other_department_or_school.value) {
                requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_other_department_or_school.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_other_department_or_school.value + "<br>\n";
                data['field_1599'] = frmData.sect_requestor_information.fields.fld_other_department_or_school.value;
            }
        }
    }
    requestorInfo += "</p><br>\n";

    // Prepare email content for Library staff
    msg = "<p>The request below was submitted through the Library Zoom Room Request form:</p><br>\n\n";
    libOptions.from = frmData.sect_requestor_information.fields.fld_email_address.value;
    libOptions.replyTo = frmData.sect_requestor_information.fields.fld_email_address.value;
    libOptions.to = 'cradmin@virginia.edu,libevents@virginia.edu';
    libOptions.subject = 'Zoom Room reservation request';
    libOptions.html = msg + requestorInfo + inputs + meetingInfo + courseInfo + reservationInfo + roomInfo + commentInfo + reqText;
    libOptions.text = stripHtml(msg + requestorInfo + inputs + meetingInfo + courseInfo + reservationInfo + roomInfo + commentInfo + reqText);

    // Prepare email confirmation content for patron
    msg = "<p>We have received your Zoom Room reservation request. A Library staff member will reply within 48 hours ";
    msg += "(during normal business hours, i.e. Monday through Friday 8:00 a.m. to 5:00 p.m.). If you do not hear from ";
    msg += "a staff member by that time, please contact the room booking coordinator, Stephanie Crooks, at 243-8788 or ";
    msg += "sac3m@virginia.edu..</p><br>\n\n";
    msg += "<p>Below is a copy of what you submitted.</p><br>\n\n";
    userOptions.from = '"UVA Library Events Team" <libevents@virginia.edu>';
    userOptions.replyTo = '"UVA Library Events Team" <libevents@virginia.edu>';
    userOptions.to = frmData.sect_requestor_information.fields.fld_email_address.value;
    userOptions.subject = 'Your Zoom Room reservation request';
    userOptions.html = msg + requestorInfo + inputs + meetingInfo + courseInfo + reservationInfo + roomInfo + commentInfo + reqText;
    userOptions.text = stripHtml(msg + requestorInfo + inputs + meetingInfo + courseInfo + reservationInfo + roomInfo + commentInfo + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, requestZoomRoomDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

async function processRequestZoomWebinar(reqId, submitted, frmData, libOptions, userOptions) {
    let requestorInfo = webinarInfo = msg = inputs= '';
    let reqText = "<br>\n<br>\n<br>\n<strong>req #: </strong>" + reqId;
    let data = { 'field_1632': reqId, 'ts_start': submitted };

    webinarInfo += "<br>\n";
    webinarInfo += "\n<h3>"+frmData.sect_webinar_information.title+"</h3>\n\n";
    if (frmData.sect_webinar_information.fields.fld_topic.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_topic.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_topic.value + "<br>\n";
        data['field_1634'] = frmData.sect_webinar_information.fields.fld_topic.value;
    }
    if (frmData.sect_webinar_information.fields.fld_description.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_description.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_description.value + "<br>\n";
        data['field_1635'] = frmData.sect_webinar_information.fields.fld_description.value;
    }
    if (frmData.sect_webinar_information.fields.fld_use_a_template_from_a_previous_webinar.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_use_a_template_from_a_previous_webinar.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_use_a_template_from_a_previous_webinar.value + "<br>\n";
        data['field_1636'] = frmData.sect_webinar_information.fields.fld_use_a_template_from_a_previous_webinar.value;
        if (frmData.sect_webinar_information.fields.fld_use_a_template_from_a_previous_webinar.value === "Yes") {
            if (frmData.sect_webinar_information.fields.fld_zoom_template.value) {
                webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_zoom_template.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_zoom_template.value + "<br>\n";
                data['field_1637'] = frmData.sect_webinar_information.fields.fld_zoom_template.value;
            }
        }
    }
    webinarInfo += "<br/>\n\n" + frmData.sect_webinar_information.fields.mkup_hr_break.markup + "<br/>\n\n";
    if (frmData.sect_webinar_information.fields.fld_date_and_time_of_event.value) {
        let dateStr = dateTimeToString(frmData.sect_webinar_information.fields.fld_date_and_time_of_event.value);
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_date_and_time_of_event.label + ":</strong> " + dateStr + "<br>\n";
        data['field_1638'] = dateStr;
    }
    if (frmData.sect_webinar_information.fields.fld_duration.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_duration.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_duration.value + "<br>\n";
        data['field_1639'] = frmData.sect_webinar_information.fields.fld_duration.value;
    }
    if (frmData.sect_webinar_information.fields.fld_time_zone.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_time_zone.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_time_zone.value + "<br>\n";
        data['field_1640'] = frmData.sect_webinar_information.fields.fld_time_zone.value;
    }
    if (frmData.sect_webinar_information.fields.fld_recurring.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_recurring.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_recurring.value + "<br>\n";
        data['field_1641'] = frmData.sect_webinar_information.fields.fld_recurring.value;
        if (frmData.sect_webinar_information.fields.fld_recurring.value === 'Yes') {
            webinarInfo += "<br/>\n\n" + frmData.sect_webinar_information.fields.mkup_if_recurring_how_often.markup + "<br/>\n\n";
            if (frmData.sect_webinar_information.fields.fld_repeat_frequency.value) {
                webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_repeat_frequency.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_repeat_frequency.value + "<br>\n";
                data['field_1642'] = frmData.sect_webinar_information.fields.fld_repeat_frequency.value;
            }
            if (frmData.sect_webinar_information.fields.fld_repeat_every_n_day.value) {
                webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_repeat_every_n_day.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_repeat_every_n_day.value + "<br>\n";
                data['field_1643'] = frmData.sect_webinar_information.fields.fld_repeat_every_n_day.value;
            }
            webinarInfo += "<br/>\n\n" + frmData.sect_webinar_information.fields.mkup_if_recuring_end_by.markup + "<br/>\n\n";
            if (frmData.sect_webinar_information.fields.fld_end_by_date.value) {
                let dateStr = dateTimeToString(frmData.sect_webinar_information.fields.fld_end_by_date.value);
                webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_end_by_date.label + ":</strong> " + dateStr + "<br>\n";
                data['field_1644'] = dateStr;
            }
            if (frmData.sect_webinar_information.fields.fld_end_after_n_occurrences.value) {
                webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_end_after_n_occurrences.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_end_after_n_occurrences.value + "<br>\n";
                data['field_1645'] = frmData.sect_webinar_information.fields.fld_end_after_n_occurrences.value;
            }
        }
    }
    if (frmData.sect_webinar_information.fields.fld_registration_required.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_registration_required.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_registration_required.value + "<br>\n";
        data['field_1646'] = frmData.sect_webinar_information.fields.fld_registration_required.value;
    }
    if (frmData.sect_webinar_information.fields.fld_host_video.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_host_video.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_host_video.value + "<br>\n";
        data['field_1647'] = frmData.sect_webinar_information.fields.fld_host_video.value;
    }
    if (frmData.sect_webinar_information.fields.fld_panelist_video.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_panelist_video.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_panelist_video.value + "<br>\n";
        data['field_1648'] = frmData.sect_webinar_information.fields.fld_panelist_video.value;
    }
    webinarInfo += "<br/>\n\n" + frmData.sect_webinar_information.fields.mkup_webinar_options.markup + "<br/>\n\n";
    if (frmData.sect_webinar_information.fields.fld_q_and_a.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_q_and_a.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_q_and_a.value + "<br>\n";
        data['field_1649'] = frmData.sect_webinar_information.fields.fld_q_and_a.value;
    }
    if (frmData.sect_webinar_information.fields.fld_enable_practice_session.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_enable_practice_session.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_enable_practice_session.value + "<br>\n";
        data['field_1650'] = frmData.sect_webinar_information.fields.fld_enable_practice_session.value;
    }
    if (frmData.sect_webinar_information.fields.fld_enable_hd_video_for_screen_shared_video.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_enable_hd_video_for_screen_shared_video.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_enable_hd_video_for_screen_shared_video.value + "<br>\n";
        data['field_1651'] = frmData.sect_webinar_information.fields.fld_enable_hd_video_for_screen_shared_video.value;
    }
    if (frmData.sect_webinar_information.fields.fld_only_signed_in_users_can_join_this_webinar.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_only_signed_in_users_can_join_this_webinar.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_only_signed_in_users_can_join_this_webinar.value + "<br>\n";
        data['field_1652'] = frmData.sect_webinar_information.fields.fld_only_signed_in_users_can_join_this_webinar.value;
    }
    if (frmData.sect_webinar_information.fields.fld_record_webinar_automatically.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_record_webinar_automatically.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_record_webinar_automatically.value + "<br>\n";
        data['field_1653'] = frmData.sect_webinar_information.fields.fld_record_webinar_automatically.value;
    }
    if (frmData.sect_webinar_information.fields.fld_alternative_hosts.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_alternative_hosts.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_alternative_hosts.value + "<br>\n";
        data['field_1654'] = frmData.sect_webinar_information.fields.fld_alternative_hosts.value;
    }
    if (frmData.sect_webinar_information.fields.fld_panelists.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_panelists.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_panelists.value + "<br>\n";
        data['field_1655'] = frmData.sect_webinar_information.fields.fld_panelists.value;
    }
    webinarInfo += "<br/>\n\n" + frmData.sect_webinar_information.fields.mkup_email_settings.markup + "<br/>\n\n";
    if (frmData.sect_webinar_information.fields.fld_reminder_emails.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_reminder_emails.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_reminder_emails.value + "<br>\n";
        data['field_1656'] = frmData.sect_webinar_information.fields.fld_reminder_emails.value;
    }
    if (frmData.sect_webinar_information.fields.fld_reminder_emails.value === 'Yes') {
        if (frmData.sect_webinar_information.fields.fld_name_of_contact_that_attendees_can_use.value) {
            webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_name_of_contact_that_attendees_can_use.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_name_of_contact_that_attendees_can_use.value + "<br>\n";
            data['field_1657'] = frmData.sect_webinar_information.fields.fld_name_of_contact_that_attendees_can_use.value;
        }
        if (frmData.sect_webinar_information.fields.fld_email_address_of_contact_that_attendees_can_use.value) {
            webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_email_address_of_contact_that_attendees_can_use.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_email_address_of_contact_that_attendees_can_use.value + "<br>\n";
            data['field_1658'] = frmData.sect_webinar_information.fields.fld_email_address_of_contact_that_attendees_can_use.value;
        }
        if (frmData.sect_webinar_information.fields.fld_invitation_email_to_panelists.value) {
            webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_invitation_email_to_panelists.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_invitation_email_to_panelists.value + "<br>\n";
            data['field_1659'] = frmData.sect_webinar_information.fields.fld_invitation_email_to_panelists.value;
        }
        if (frmData.sect_webinar_information.fields.fld_send_confirmation_email_to_registrants.value) {
            webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_send_confirmation_email_to_registrants.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_send_confirmation_email_to_registrants.value + "<br>\n";
            data['field_1660'] = frmData.sect_webinar_information.fields.fld_send_confirmation_email_to_registrants.value;
        }
        if (frmData.sect_webinar_information.fields.fld_send_reminder_email_to_approved_registrants_and_panelists.value) {
            webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_send_reminder_email_to_approved_registrants_and_panelists.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_send_reminder_email_to_approved_registrants_and_panelists.value + "<br>\n";
            data['field_1661'] = frmData.sect_webinar_information.fields.fld_send_reminder_email_to_approved_registrants_and_panelists.value;
            if (frmData.sect_webinar_information.fields.fld_send_reminder_email_to_approved_registrants_and_panelists.value === 'Yes') {
                if (frmData.sect_webinar_information.fields.fld_when_to_send_email_to_approved_registrants_and_panelists.value) {
                    webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_when_to_send_email_to_approved_registrants_and_panelists.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_when_to_send_email_to_approved_registrants_and_panelists.value + "<br>\n";
                    data['field_1662'] = frmData.sect_webinar_information.fields.fld_when_to_send_email_to_approved_registrants_and_panelists.value;
                }
            }
        }
    }
    if (frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_attendees.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_attendees.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_attendees.value + "<br>\n";
        data['field_1663'] = frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_attendees.value;
        if (frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_attendees.value === 'Yes') {
            if (frmData.sect_webinar_information.fields.fld_how_many_days_after_the_event_should_attendees_be_emailed.value) {
                webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_how_many_days_after_the_event_should_attendees_be_emailed.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_how_many_days_after_the_event_should_attendees_be_emailed.value + "<br>\n";
                data['field_1664'] = frmData.sect_webinar_information.fields.fld_how_many_days_after_the_event_should_attendees_be_emailed.value;
            }    
        }
    }
    if (frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_absentees.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_absentees.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_absentees.value + "<br>\n";
        data['field_1665'] = frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_absentees.value;
        if (frmData.sect_webinar_information.fields.fld_send_follow_up_email_to_absentees.value === 'Yes') {
            if (frmData.sect_webinar_information.fields.fld_how_many_days_after_the_event_should_absentees_be_emailed.value) {
                webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_how_many_days_after_the_event_should_absentees_be_emailed.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_how_many_days_after_the_event_should_absentees_be_emailed.value + "<br>\n";
                data['field_1666'] = frmData.sect_webinar_information.fields.fld_how_many_days_after_the_event_should_absentees_be_emailed.value;
            }    
        }
    }
    webinarInfo += "<br/>\n\n" + frmData.sect_webinar_information.fields.mkup_polls.markup + "<br/>\n\n";
    if (frmData.sect_webinar_information.fields.fld_any_polls_needed.value) {
        webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_any_polls_needed.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_any_polls_needed.value + "<br>\n";
        data['field_1667'] = frmData.sect_webinar_information.fields.fld_any_polls_needed.value;
        if (frmData.sect_webinar_information.fields.fld_any_polls_needed.value === 'Yes') {
            if (frmData.sect_webinar_information.fields.fld_what_polls_are_needed.value) {
                webinarInfo += "<strong>" + frmData.sect_webinar_information.fields.fld_what_polls_are_needed.label + ":</strong> " + frmData.sect_webinar_information.fields.fld_what_polls_are_needed.value + "<br>\n";
                data['field_1668'] = frmData.sect_webinar_information.fields.fld_what_polls_are_needed.value;
            }
        }
    }
    webinarInfo += "<br>\n";

    requestorInfo += "\n<h3>" + frmData.sect_requestor_information.title + "</h3>\n\n<p>";
    if (frmData.sect_requestor_information.fields.fld_uva_computing_id.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_uva_computing_id.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_uva_computing_id.value + "<br>\n";
        data['field_1669'] = frmData.sect_requestor_information.fields.fld_uva_computing_id.value;
    }
    if (frmData.sect_requestor_information.fields.fld_name.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_name.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_name.value + "<br>\n";
        data['field_1670'] = frmData.sect_requestor_information.fields.fld_name.value;
    }
    if (frmData.sect_requestor_information.fields.fld_email_address.value) {
        requestorInfo += "<strong>" + frmData.sect_requestor_information.fields.fld_email_address.label + ":</strong> " + frmData.sect_requestor_information.fields.fld_email_address.value + "<br>\n";
        data['field_1671'] = frmData.sect_requestor_information.fields.fld_email_address.value;
    }
    requestorInfo += "</p><br>\n";

    // Prepare email content for Library staff
    msg = "<p>The request below was submitted through the Library Internal Zoom Webinar Request form.</p><br>\n\n";
    msg += "<p><a href='https://virginia.libinsight.com/dataseta.php?id=23619'"+">Access the request in the LibInsight Internal Zoom Webinar Requests dataset.</a></p><br>\n\n";
    libOptions.from = frmData.sect_requestor_information.fields.fld_email_address.value;
    libOptions.replyTo = frmData.sect_requestor_information.fields.fld_email_address.value;
    libOptions.to = 'lib-zoomweb@virginia.edu';
    libOptions.subject = 'Internal Zoom Webinar Request';
    libOptions.html = msg + requestorInfo + webinarInfo + reqText;
    libOptions.text = stripHtml(msg + requestorInfo + webinarInfo + reqText);

    // Prepare email confirmation content for patron
    msg = "<p>We have received your Internal Zoom Webinar request.</p><br>\n\n";
    msg += "<p>Below is a copy of what you submitted.</p><br>\n\n";
    userOptions.from = '"UVA Library Zoom Webinar Team" <lib-zoomweb@virginia.edu>';
    userOptions.replyTo = '"UVA Library Zoom Webinar Team" <lib-zoomweb@virginia.edu>';
    userOptions.to = frmData.sect_requestor_information.fields.fld_email_address.value;
    userOptions.subject = 'Your Internal Zoom Webinar Request';
    userOptions.html = msg + requestorInfo + webinarInfo + reqText;
    userOptions.text = stripHtml(msg + requestorInfo + webinarInfo + reqText);

    try {
        return postEmailAndData(reqId, libOptions, userOptions, requestInternalZoomWebinarDatasetApi, data);
    }
    catch (error) {
        console.log(`error: ${JSON.stringify(error)}`);
        return error;
    }
}

function sessionLengthAndChoicesToString(data) {
    let str = '';
    str += "<h4>Session " + data.nth + "</h4>\n\n";
    if (data.session.sessionLength !== "") {
        str += "<p><strong>Session length (minutes)</strong><br>\n" + data.session.sessionLength + "</p>\n\n";
    }
    for (let j=0; j < data.session.sessionDateTime.length; j++) {
        str += choiceDateTimeToString(data.session.sessionDateTime[j]);
    }
    return str;
}

function paramsString(obj) {
    return Object.keys(obj).map(key => key + '=' + encodeURIComponent(obj[key])).join('&');
}

function postEmailAndData(reqId, requestEmailOptions, confirmEmailOptions, apiUrl, formData) {
    queryString = paramsString(requestEmailOptions);
    nodeFetch(emailUrl, { method: 'POST', body: queryString, headers: headerObj })
    .then(res => res.text())
    .then(body => {
        if (body && (body.search('Status: 201 Created') !== -1)) {
            console.log(`Library request notification sent for ${reqId}: `+body);
            queryString = paramsString(confirmEmailOptions);
            return nodeFetch(emailUrl, { method: 'POST', body: queryString, headers: headerObj });
        } else {
            console.log(`Library request notification failed for ${reqId}: `+body);
            throw new Error(`Library request notification failed for ${reqId}: `+body);
        }
    })
    .then(res => res.text())
    .then(body => {
        if(body && (body.search('Status: 201 Created') !== -1)) {
            console.log(`Patron confirmation notification sent for ${reqId}: `+body);
            queryString = paramsString(formData);
            return nodeFetch(apiUrl, { method: 'POST', body: queryString, headers: headerObj });
        } else {
            console.log(`Patron confirmation notification failed for ${reqId}: `+body);
            throw new Error(`Patron confirmation notification failed for ${reqId}: `+body);
        }
    })
    .then(res => res.text())
    .then(body => {
        if (body) {
            const result = JSON.parse(body);
            if (result.response) {
                console.log(`LibInsight data saved for ${reqId}: `+body);
            }
            const deleteFiles = [];
            // Emails successfully sent, delete uploaded file if attached to email.
            if (requestEmailOptions.sourceFile !== "" && requestEmailOptions.attach_type === 'attach') {
                deleteFiles.push(deleteFirebaseFile(requestEmailOptions.sourceFile));
            }
            if (requestEmailOptions.sourceFile1 !== "" && requestEmailOptions.attach_type1 === 'attach') {
                deleteFiles.push(deleteFirebaseFile(requestEmailOptions.sourceFile1));
            }
            return Promise.all(deleteFiles);
        } else {
            console.log(`Bad response from ${apiUrl}: `+body);
            throw new Error(`Bad response from ${apiUrl}: `+body);
        }
    })
    .catch(error => function(error) {
        console.log(`Error for request ${reqId}: `);
        console.log(error);
        return error;
    });
}

function postEmailOnly(reqId, requestEmailOptions, confirmEmailOptions) {
    queryString = paramsString(requestEmailOptions);
    nodeFetch(emailUrl, { method: 'POST', body: queryString, headers: headerObj })
    .then(res => res.text())
    .then(body => {
        if (body && (body.search('Status: 201 Created') !== -1)) {
            console.log(`Library request notification sent for ${reqId}: `+body);
            queryString = paramsString(confirmEmailOptions);
            return nodeFetch(emailUrl, { method: 'POST', body: queryString, headers: headerObj });
        } else {
            console.log(`Library request notification failed for ${reqId}: `+body);
            throw new Error(`Library request notification failed for ${reqId}: `+body);
        }
    })
    .then(res => res.text())
    .then(body => {
        if(body && (body.search('Status: 201 Created') !== -1)) {
            console.log(`Patron confirmation notification sent for ${reqId}: `+body);
            queryString = paramsString(formData);
            return body;
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
