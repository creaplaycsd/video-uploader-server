require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ✅ ADD THIS MIDDLEWARE
app.use((req, res, next) => {
  console.log(`--> Incoming Request: ${req.method} ${req.originalUrl}`);
  next();
});
// Google OAuth2 Client
const oAuth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

// Google Drive API Client
const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// Health check
app.get('/', (req, res) => {
    res.send('Video Uploader Server is running!');
});

/**
 * Helper function to find a folder ID by name and parent
 */
async function findFolderId(folderName, parentFolderId) {
    try {
        // Return null if there's no parent or name to search for
        if (!parentFolderId || !folderName) {
            return null;
        }

        // 1. Get a list of ALL subfolders within the parent folder
        const res = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
            // Important: We need to fetch the 'name' field to compare it
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const allSubfolders = res.data.files;
        if (!allSubfolders || allSubfolders.length === 0) {
            return null; // No subfolders found at all
        }

        // 2. Loop through the results and compare names in lowercase
        const targetFolderName = folderName.toLowerCase();
        const foundFolder = allSubfolders.find(
            (folder) => folder.name.toLowerCase() === targetFolderName
        );

        // 3. Return the folder's ID if we found a match, otherwise return null
        return foundFolder ? foundFolder.id : null;

    } catch (err) {
        console.error(`Error in findFolderId while searching for "${folderName}":`, err.message);
        return null;
    }
}

/**
 * Helper function to duplicate a file and rename it
 */
async function duplicateFile(originalFileId, newFileName, newParentFolderId) {
    try {
        if (!originalFileId || !newFileName || !newParentFolderId) {
            console.error('Missing parameters for file duplication');
            return null;
        }

        const { token } = await oAuth2Client.getAccessToken();

        // Copy the file
        const res = await drive.files.copy({
            fileId: originalFileId,
            requestBody: {
                name: newFileName,
                parents: [newParentFolderId]
            }
        });

        return res.data;
    } catch (err) {
        console.error('Error duplicating file:', err.response?.data || err.message);
        return null;
    }
}

/**
 * Create resumable upload session for INDIVIDUAL upload
 */
app.post('/create-upload-session', async (req, res) => {
    console.log('✅ Route /create-upload-session was matched!');
    try {
        const { filename, course, centre, batch, level, studentName } = req.body;

        // Log the exact data received from the form
        console.log('--- Received Data ---');
        console.log(`Course:  [${course}]`);
        console.log(`Centre:  [${centre}]`);
        console.log(`Batch:   [${batch}]`);
        console.log(`Level:   [${level}]`);
        console.log(`Student: [${studentName}]`);
        console.log('---------------------');

        // Log each step of the folder search
        console.log(`1. Searching for Course folder: "${course}"...`);
        const courseFolderId = await findFolderId(course, process.env.ROOT_FOLDER_ID);
        console.log(`   => Found Course ID: ${courseFolderId}`);

        console.log(`2. Searching for Centre folder: "${centre}" in parent ${courseFolderId}...`);
        const centreFolderId = await findFolderId(centre, courseFolderId);
        console.log(`   => Found Centre ID: ${centreFolderId}`);

        console.log(`3. Searching for Batch folder: "${batch}" in parent ${centreFolderId}...`);
        const batchFolderId = await findFolderId(batch, centreFolderId);
        console.log(`   => Found Batch ID: ${batchFolderId}`);

        console.log(`4. Searching for Level folder: "${level}" in parent ${batchFolderId}...`);
        const levelFolderId = await findFolderId(level, batchFolderId);
        console.log(`   => Found Level ID: ${levelFolderId}`);

        console.log(`5. Searching for Student folder: "${studentName}" in parent ${levelFolderId}...`);
        const folderId = await findFolderId(studentName, levelFolderId);
        console.log(`   => Found Student ID: ${folderId}`);

        if (!folderId) {
            console.error('FINAL FOLDER LOOKUP FAILED. The step that returned "null" above is the problem.');
            return res.status(404).json({ error: `Folder for "${studentName}" not found. Check server logs for details.` });
        }

        const uploadUrl = sessionResponse.headers['location'];
        return res.json({ uploadUrl, accessToken: token, fileId: sessionResponse.data.id });
    } catch (err) {
        console.error('Error creating upload session:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Create resumable upload session for GROUP upload and handle duplication
 */
app.post('/create-group-upload-session', async (req, res) => {
    try {
        const { filename, mimeType, course, centre, batch, level, studentName, selectedStudents } = req.body;
        if (!filename || !studentName || !selectedStudents || selectedStudents.length === 0) {
            return res.status(400).json({ error: 'Missing required group upload fields.' });
        }

        const courseFolderId = await findFolderId(course, process.env.ROOT_FOLDER_ID);
        const centreFolderId = await findFolderId(centre, courseFolderId);
        const batchFolderId = await findFolderId(batch, centreFolderId);
        const levelFolderId = await findFolderId(level, batchFolderId);
        const folderId = await findFolderId(studentName, levelFolderId);

        if (!folderId) {
            return res.status(404).json({ error: `Folder for primary student ${studentName} not found.` });
        }

        const { token } = await oAuth2Client.getAccessToken();
        if (!token) throw new Error('Failed to retrieve access token');

        // 1. Create a single resumable upload session
        const sessionResponse = await axios.post(
            `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`,
            { name: filename, parents: [folderId] },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                },
            }
        );
        const uploadUrl = sessionResponse.headers['location'];
        const originalFileId = sessionResponse.data.id;

        // 2. Respond immediately to the client with the session URL
        res.json({ uploadUrl, accessToken: token, fileId: originalFileId });

        // 3. Perform file duplication in the background
        if (originalFileId) {
            for (const student of selectedStudents) {
                if (student === studentName) continue; // Skip primary student
                
                const studentFolderId = await findFolderId(student, levelFolderId);
                if (studentFolderId) {
                    const extension = filename.split('.').pop();
                    const newFileName = `${filename.split('_')[0]}_${student}_${level}_${centre}.${extension}`;
                    await duplicateFile(originalFileId, newFileName, studentFolderId);
                } else {
                    console.warn(`Folder for student ${student} not found. Skipping duplication.`);
                }
            }
        }

    } catch (err) {
        console.error('Error creating group upload session:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});
