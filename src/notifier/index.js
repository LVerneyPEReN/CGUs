import dotenv from 'dotenv';
dotenv.config();

import sendInBlue from 'sib-api-v3-sdk';
const defaultClient = sendInBlue.ApiClient.instance;

const authentication = defaultClient.authentications['api-key'];
authentication.apiKey = process.env.SENDINBLUE_API_KEY;

const apiInstance = new sendInBlue.SMTPApi();
const contactsInstance = new sendInBlue.ContactsApi();

const LIST_FOLDER_ID = Number(process.env.NODE_ENV === 'test' ? process.env.LIST_TEST_FOLDER_ID : process.env.LIST_FOLDER_ID);
const UPDATE_TEMPLATE_ID = Number(process.env.UPDATE_TEMPLATE_ID);
const ERROR_TEMPLATE_ID = Number(process.env.ERROR_TEMPLATE_ID);
const BASE_URL = process.env.BASE_URL;

const serviceProvidersMailingLists = {};
let serviceProviders;
let documentTypes;

let initialized;
export async function init(passedServiceProviders, passedDocumentTypes) {
  if (!initialized) {
    serviceProviders = passedServiceProviders;
    documentTypes = passedDocumentTypes;
    return bootstrapMailingLists().then(() => {
      initialized = Promise.resolve();
    });
  }

  return initialized;
}

async function bootstrapMailingLists() {
  const listsPromises = [];

  Object.keys(serviceProviders).forEach((serviceProviderId) => {
    const { documents, serviceProviderName } = serviceProviders[serviceProviderId];

    serviceProvidersMailingLists[serviceProviderId] = {};

    listsPromises.push(generateServiceProviderMailingList({ serviceProviderName, serviceProviderId }));

    Object.keys(documents).forEach((documentId) => {
      listsPromises.push(generateDocumentsMailingLists({
        serviceProviderName,
        serviceProviderId,
        documentName: documentTypes[documentId].name,
        documentId,
      }));
    });
  });

  return Promise.all(listsPromises);
}

export async function onDocumentScrapingError(serviceProviderId, documentTypeId, error) {
  const sendParams = {
    templateId: ERROR_TEMPLATE_ID,
    params: {
      SERVICE_PROVIDER_NAME: serviceProviders[serviceProviderId].serviceProviderName,
      DOCUMENT_TYPE: documentTypes[documentTypeId].name,
      ERROR_TEXT: `An error has occured when trying to scrape the document:
${error}`
    },
  }

  return send([
    serviceProvidersMailingLists[serviceProviderId].baseListId,
    serviceProvidersMailingLists[serviceProviderId][documentTypeId].errorListId
  ], sendParams);
}

export async function onSanitizedDocumentChange(serviceProviderId, documentTypeId, sanitizedSha) {
  const sendParams = {
    templateId: UPDATE_TEMPLATE_ID,
    params: {
      SERVICE_PROVIDER_NAME: serviceProviders[serviceProviderId].serviceProviderName,
      DOCUMENT_TYPE: documentTypes[documentTypeId].name,
      URL: `${BASE_URL}${sanitizedSha}`
    },
  }

  return send([
    serviceProvidersMailingLists[serviceProviderId].baseListId,
    serviceProvidersMailingLists[serviceProviderId][documentTypeId].updateListId
  ], sendParams);
};

async function send(lists, sendParams) {
  const sendPromises = [];

  lists.forEach(async listId => {
    const listContacts = await getListContacts(listId);
    if (listContacts.length) {
      sendPromises.push(apiInstance.sendTransacEmail({
        ...sendParams,
        to: listContacts.map(contact => ({ email: contact.email }))
      }));
    }
  });

  return Promise.all(sendPromises);
}

async function generateServiceProviderMailingList({ serviceProviderName, serviceProviderId }) {
  const baseListId = await createListIfNotExists(serviceProviderName);

  serviceProvidersMailingLists[serviceProviderId].baseListId = baseListId;
}

async function generateDocumentsMailingLists({ serviceProviderName, serviceProviderId, documentName, documentId }) {
  const baseListName = `${serviceProviderName} ${documentName}`;
  const updateListName = `${baseListName} update`;
  const errorListName = `${baseListName} error`;
  const updateListId = await createListIfNotExists(updateListName);
  const errorListId = await createListIfNotExists(errorListName);

  serviceProvidersMailingLists[serviceProviderId][documentId] = {
    updateListId,
    errorListId
  };
}

export async function createListIfNotExists(listName) {
  const lists = await getFolderLists(LIST_FOLDER_ID);

  const existingList = lists && lists.find(list => list.name === listName);
  if (existingList) {
    return existingList.id;
  }

  const list = await contactsInstance.createList({
    name: listName,
    folderId: LIST_FOLDER_ID,
  });
  return list.id;
}

async function getListContacts(listId) {
  let offset = 0;
  let limit = 50;
  const list = await contactsInstance.getList(listId);

  return _aggregate('getContactsFromList', 'contacts', listId, limit, offset, [], list.totalSubscribers);
}

export async function getFolderLists(folderId) {
  let offset = 0;
  let limit = 50;

  const { lists, count } = await contactsInstance.getFolderLists(folderId, {
    limit,
    offset
  });

  if (!lists) {
    return [];
  }

  return _aggregate('getFolderLists', 'lists', folderId, limit, offset + limit, [...lists], count);
}

async function _aggregate(functionName, resultKey, resourceId, limit, offset, aggregator, count) {
  if (aggregator.length >= count) {
    return aggregator;
  }

  const result = await contactsInstance[functionName](resourceId, { limit, offset });
  aggregator = aggregator.concat(result[resultKey]);
  return _aggregate(functionName, resultKey, resourceId, limit, offset + limit, aggregator, count);
}
