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
   // ✅ ADD THIS LINE RIGHT AT THE TOP FOR PROOF
  console.log('--- Running NEW case-insensitive findFolderId function! ---');
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
    console.log('--- RUNNING "LIST ALL FOLDERS" DEBUG TEST ---');
    try {
        const parentFolderId = process.env.ROOT_FOLDER_ID;
        console.log(`Attempting to list ALL folders inside parent ID: ${parentFolderId}`);

        // The query is now simplified to list ALL folders in the parent.
        const response = await drive.files.list({
            q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)', // We need name and ID
            spaces: 'drive',
        });

        console.log('✅ Google API call was successful.');
        console.log('Found the following folders inside the root:');
        // Log the entire list of found folders
        console.log(JSON.stringify(response.data.files, null, 2));

        res.status(200).json({
            message: 'Debug test complete. Check server logs to see the list of all folders found.',
            data: response.data.files
        });

    } catch (err) {
        console.error('!!! GOOGLE API CALL FAILED !!!');
        console.error('FULL GOOGLE API ERROR:', JSON.stringify(err, null, 2));
        res.status(500).json({ error: 'Debug test failed. Check server logs.' });
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
