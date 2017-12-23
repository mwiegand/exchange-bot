/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var fs = require('fs'); // file system for loading JSON
var vcapServices = require('vcap_services');
var conversationCredentials = vcapServices.getCredentials('conversation');
var watson = require('watson-developer-cloud'); // watson sdk

var express = require('express'); // app server
var bodyParser = require('body-parser'); // parser for post requests

var app = express();

require('metrics-tracker-client').track();

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());

var workspaceID; // workspaceID will be set when the workspace is created or validated.
var workspaceName = process.env.WORKSPACE_NAME;

// Create the service wrapper
var conversation = watson.conversation({
  url: conversationCredentials.url || process.env.CONVERSATION_URL || 'https://gateway.watsonplatform.net/conversation/api',
  username: conversationCredentials.username || process.env.CONVERSATION_USERNAME,
  password: conversationCredentials.password || process.env.CONVERSATION_PASSWORD,
  version_date: '2016-07-11',
  version: 'v1'
});

// set either an active conversation workspace, workspace-name in the environment-variables or the first workspace in the list
function set_conv_workspace(callback) {
  conversation.listWorkspaces(function (err, response) {
    if (err) {
      console.error(err);
    } else if (response.workspaces && response.workspaces.length === 0){
      uploadFirstChatbot();                                           // upload default chatbot if workspaces list is empty
      callback();
    } else {
      var workspace = response.workspaces.find(function (workspace) {
        if (workspace.name.toLowerCase().indexOf('active') !== -1) { // find either an active workspace
          return true;
        } else if (workspaceName) {
          return workspace.name === workspaceName;                  // find workspace-name in environment-variables
        }
      }) || response.workspaces[0];                                 // find the first workspace in the list
      if (workspace.hasOwnProperty('workspace_id')) {
        if (workspaceID !== workspace.workspace_id) {
          workspaceID = workspace.workspace_id;                     // set found conversation workspace
        }
      }
      callback();
    }
  });
}

function uploadFirstChatbot() {
  var workspace = JSON.parse(fs.readFileSync('data/your-first-chatbot-workspace.json', 'utf8'));
  
  conversation.createWorkspace(workspace, function(err, response) {
    if (err) {
      console.error(err);
    } else {
      var workspace = JSON.stringify(response, null, 2);
      console.log('workspace uploaded:');
      console.log(workspace);
      workspaceID = workspace.workspace_id;
    }
   });
}

set_conv_workspace(function(){
  console.log('##################################');
  console.log('#   conversation workspace set   #');
  console.log('##################################');
});

app.use('/', function (req, res, next) {
  // console.log(req);
  console.log('blub');
  set_conv_workspace(next);
});

// Endpoint to be call from the client side
app.post('/api/message', function (req, res) {

  if (!workspaceID) {
    return res.json({
      output: {
        text: '...searching for Conversation Workspace. If there is no Workspace I\'m uploading your first Workpace in your Conversation Service. Please reload the Page.'
      }
    });
  }

  var payload = {
    workspace_id: workspaceID,
    context: req.body.context || {},
    input: req.body.input || {}
  };

  // Send the input to the conversation service
  conversation.message(payload, function (err, data) {
    if (err) {
      set_conv_workspace(function(){console.log('resolving error')});
      return res.json({
        output: {
          text: '...searching for Conversation Workspace. If there is no Workspace I\'m uploading your first Workpace in your Conversation Service. Please reload the Page.'
        }});
    }
    return res.json(updateMessage(payload, data));
  });
});

/**
 * Updates the response text using the intent confidence
 * @param  {Object} input The request to the Conversation service
 * @param  {Object} response The response from the Conversation service
 * @return {Object}          The response with the updated message
 */
function updateMessage(input, response) {
  var responseText = null;
  if (!response.output) {
    response.output = {};
  } else {
    return response;
  }
  if (response.intents && response.intents[0]) {
    var intent = response.intents[0];
    // Depending on the confidence of the response the app can return different messages.
    // The confidence will vary depending on how well the system is trained. The service will always try to assign
    // a class/intent to the input. If the confidence is low, then it suggests the service is unsure of the
    // user's intent . In these cases it is usually best to return a disambiguation message
    // ('I did not understand your intent, please rephrase your question', etc..)
    if (intent.confidence >= 0.75) {
      responseText = 'I understood your intent was ' + intent.intent;
    } else if (intent.confidence >= 0.5) {
      responseText = 'I think your intent was ' + intent.intent;
    } else {
      responseText = 'I did not understand your intent';
    }
  }
  response.output.text = responseText;
  return response;
}

module.exports = app;