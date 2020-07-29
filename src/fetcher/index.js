import nodeFetch from 'node-fetch';
import HttpProxyAgent from 'http-proxy-agent';
import HttpsProxyAgent from 'https-proxy-agent';

const LANGUAGE = 'en'

export default async function fetch(url, asText = true) {
  const options = {};
  if (url.startsWith('https:') && process.env.HTTPS_PROXY) {
    options.agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
  }
  else if (url.startsWith('http:') && process.env.HTTP_PROXY) {
    options.agent = new HttpProxyAgent(process.env.HTTP_PROXY);
  }
  options.headers = {'Accept-Language': LANGUAGE}

  const response = await nodeFetch(url, options);

  if (!response.ok) {
    throw new Error(`Received HTTP code ${response.status} when trying to fetch '${url}'`);
  }

  const blob = await response.blob();

  if (asText) {
    return blob.text();
  } else {
    return blob;
  }
}
