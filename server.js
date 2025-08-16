require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cors({
  origin: '*', // Allow all origins for testing. For production, set this to your frontend URL.
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Content-Range'],
}));
console.log("Server is starting up and ready to receive requests!");
// Google OAuth2 Client
const oAuth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

// Health check
app.get('/', (req, res) => {
    res.send('Video Uploader Server is running!');
});

// Create resumable upload session
app.post('/create-upload-session', async (req, res) => {
  console.log("Received a request to create an upload session.");
    try {
        const { filename, mimeType, folderId, uploaderId } = req.body;
        if (!filename || !folderId) {
            return res.status(400).json({ error: 'filename and folderId are required.' });
        }

        const { token } = await oAuth2Client.getAccessToken();
        if (!token) throw new Error('Failed to retrieve access token');

        const sessionResponse = await axios.post(
            `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`,
            { 
                name: filename, 
                parents: [folderId],
                // Include the uploader's ID as a file property
                appProperties: {
                    uploader: uploaderId
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                },
            }
        );

        const uploadUrl = sessionResponse.headers['location'];
        return res.json({ uploadUrl, accessToken: token });
    } catch (err) {
        console.error('Error creating upload session:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

// New endpoint: Get group folder IDs
app.post('/get-group-folder-ids', async (req, res) => {
    try {
        const { students, course, centre, batch, level } = req.body;
        if (!students || !Array.isArray(students) || students.length === 0) {
            return res.status(400).json({ error: 'An array of students is required.' });
        }

        const folderIds = {};
        
        for (const student of students) {
            const folderIdLookupURL = `https://script.google.com/macros/s/AKfycbxydrQ8X_pTr77N8C1yOuJaXhopirPv0t0a1d1IQPSnHgvgGM_x2tDf_z3c_zUdybs/exec?action=getFolderId&course=${encodeURIComponent(course)}&centre=${encodeURIComponent(centre)}&batch=${encodeURIComponent(batch)}&level=${encodeURIComponent(level)}&student=${encodeURIComponent(student)}`;
            const response = await fetch(folderIdLookupURL);
            const folderId = (await response.text()).trim();
            if (folderId && folderId !== "NOT_FOUND") {
                folderIds[student] = folderId;
            } else {
                console.warn(`Folder ID not found for student: ${student}`);
            }
        }
        
        res.status(200).json({ folderIds });
    } catch (err) {
        console.error('Error getting group folder IDs:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// New endpoint: Search for a file by name and parent folder
app.post('/find-file-id', async (req, res) => {
    try {
        const { filename, course, centre, batch, level, student, extension } = req.body;
        if (!filename || !student || !extension) {
            return res.status(400).json({ error: 'Filename, student, and extension are required.' });
        }

        const { token } = await oAuth2Client.getAccessToken();
        if (!token) throw new Error('Failed to retrieve access token');
        const drive = google.drive({ version: 'v3', auth: oAuth2Client });
        const searchName = `${filename}_${student}_${level}_${centre}.${extension}`;
        const response = await drive.files.list({
            q: `name='${searchName}' and trashed=false`,
            fields: 'files(id, webViewLink)',
            spaces: 'drive',
            oauth_token: token
        });
        const files = response.data.files;
        if (files.length > 0) {
            res.status(200).json({ fileId: files[0].id, fileLink: files[0].webViewLink });
        } else {
            res.status(404).json({ error: 'File not found.' });
        }
    } catch (err) {
        console.error('Error finding file:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

// New endpoint: Duplicate files
app.post('/duplicate-files', async (req, res) => {
    try {
        const { sourceFileId, renameData } = req.body;
        if (!sourceFileId || !renameData || !Array.isArray(renameData) || renameData.length === 0) {
            return res.status(400).json({ error: 'Missing source file ID or rename data.' });
        }

        const { token } = await oAuth2Client.getAccessToken();
        if (!token) throw new Error('Failed to retrieve access token');

        const drive = google.drive({ version: 'v3', auth: oAuth2Client });

        // --- CHANGE 1: Get the appProperties from the source file
        const sourceFile = await drive.files.get({ fileId: sourceFileId, fields: 'appProperties' });
        const appProperties = sourceFile.data.appProperties;

        // --- CHANGE 2: Immediately send a response to the frontend to prevent timeout
        res.status(202).json({ status: 'Duplication process started.' });

        // --- CHANGE 3: Replace the for loop with Promise.all for asynchronous processing
        const duplicationPromises = renameData.map(data => {
            return drive.files.copy({
                fileId: sourceFileId,
                requestBody: {
                    name: data.newFilename,
                    parents: [data.folderId],
                    // --- CHANGE 4: Copy the appProperties to the new file
                    appProperties: appProperties
                }
            }).catch(copyError => {
                console.error(`Failed to copy file for student ${data.student}:`, copyError.message);
                return { student: data.student, status: 'failed', error: copyError.message };
            });
        });

        // --- CHANGE 5: Execute all the promises concurrently in the background
        const results = await Promise.all(duplicationPromises);
        console.log("Duplication process finished:", results);

    } catch (err) {
        console.error('Error starting duplication process:', err.response?.data || err.message);
        // Note: Do not send a response here, as it's already sent above
    }
});

// New endpoint: Proxy log data to Google Apps Script
app.post('/log-upload', async (req, res) => {
    try {
        const logData = req.body;
        const appsScriptURL = "https://script.google.com/macros/s/AKfycbxydrQ8X_pTr77N8C1yOuJaXhopirPv0t0a1d1IQPSnHgvgGM_x2tDf_z3c_zUdybs/exec?action=log";

        const response = await axios.post(appsScriptURL, logData, {
            headers: { 'Content-Type': 'application/json' }
        });

        // Forward the Apps Script's response to the frontend
        res.status(response.status).json(response.data);
    } catch (err) {
        console.error('Error proxying log data:', err.response?.data || err.message);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Server started at http://localhost:${port}`);
});
