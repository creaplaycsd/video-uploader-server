require('dotenv').config({ path: __dirname + '/.env' });
const { google } = require('googleapis');
const readline = require('readline');

console.log('CLIENT_ID:', process.env.CLIENT_ID); // Debug

const CLIENT_ID = process.env.CLIENT_ID || "52438342041-sgjsom74lsd28g6cfa3e0mjem6uc1p1h.apps.googleusercontent.com";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "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";
const REDIRECT_URI = process.env.REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob";

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);


const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const url = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
});

console.log('Authorize this app by visiting this url:', url);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter the code from that page here: ', async (code) => {
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    console.log('Your refresh token:', tokens.refresh_token);
    console.log('Copy this refresh token into your .env file as REFRESH_TOKEN=');
  } catch (err) {
    console.error('Error retrieving access token', err);
  }
  rl.close();
});
