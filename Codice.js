function doGet() {
  return HtmlService.createHtmlOutputFromFile('InputDialog')
    .setWidth(400)
    .setHeight(300);
}

function saveParameters(email, folderUrl) {
  // Salva i parametri nelle proprietà dello script
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty('email', email);
  properties.setProperty('folderUrl', folderUrl);
  return "Parametri salvati con successo.";
}

function getParameters() {
  // Recupera i parametri salvati
  var properties = PropertiesService.getScriptProperties();
  return {
    email: properties.getProperty('email') || '',
    folderUrl: properties.getProperty('folderUrl') || ''
  };
}

function findFilesSharedWith(email, folderUrl) {
  function extractFolderId(url) {
    var match = url.match(/\/folders\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      return match[1];
    } else {
      throw new Error("Impossibile estrarre l'ID della cartella dall'URL fornito.");
    }
  }

  function isSharedWithUser(permissions, email) {
    if (!permissions) return false;
    return permissions.some(permission => permission.emailAddress === email);
  }

  function getFolderPermissions(folderId) {
    try {
      var response = Drive.Permissions.list(folderId, { 
        supportsAllDrives: true,
        fields: "permissions(emailAddress, role, type)"
      });

      return response.permissions || [];
    } catch (error) {
      Logger.log("❌ Errore nel recupero dei permessi della cartella: " + error.message);
      return [];
    }
  }

  function getFilePermissions(fileId) {
    try {
      var response = Drive.Permissions.list(fileId, { 
        supportsAllDrives: true,
        fields: "permissions(emailAddress, role, type)"
      });

      return response.permissions || [];
    } catch (error) {
      Logger.log("❌ Errore nel recupero dei permessi del file " + fileId + ": " + error.message);
      return [];
    }
  }

  function searchFilesInFolder(folderId, folderPath) {
    var sharedFiles = [];
    var folderPermissions = getFolderPermissions(folderId);

    try {
      var pageToken = null;
      do {
        var response = Drive.Files.list({
          q: "'" + folderId + "' in parents and trashed = false",
          fields: "nextPageToken, files(id, name, mimeType)",
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          maxResults: 100
        });

        var items = response.files;
        if (items && items.length > 0) {
          for (var i = 0; i < items.length; i++) {
            var file = items[i];
            var isShared = false;
            var filePermissions = getFilePermissions(file.id);

            // 1️⃣ Controlla i permessi del file
            if (filePermissions.length > 0) {
              isShared = isSharedWithUser(filePermissions, email);
            }

            // 2️⃣ Se il file non ha permessi visibili, controlla la cartella
            if (!isShared && folderPermissions.length > 0) {
              isShared = isSharedWithUser(folderPermissions, email);
            }

            if (isShared) {
              var fullPath = folderPath + "/" + file.name;
              sharedFiles.push({
                name: fullPath,
                id: file.id,
                link: "https://drive.google.com/file/d/" + file.id
              });
            }
          }
        }

        pageToken = response.nextPageToken;
      } while (pageToken);

    } catch (error) {
      Logger.log("❌ Errore durante il recupero dei file nella cartella " + folderPath + ": " + error.message);
    }

    return sharedFiles;
  }

  function searchAllFolders(rootFolderId, rootFolderName) {
    var allSharedFiles = [];
    var foldersToProcess = [{ id: rootFolderId, path: rootFolderName }];

    while (foldersToProcess.length > 0) {
      var currentFolder = foldersToProcess.pop();
      var filesInFolder = searchFilesInFolder(currentFolder.id, currentFolder.path);
      allSharedFiles = allSharedFiles.concat(filesInFolder);

      // Cerca eventuali sottocartelle
      try {
        var response = Drive.Files.list({
          q: "'" + currentFolder.id + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
          fields: "files(id, name)",
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          maxResults: 100
        });

        if (response.files && response.files.length > 0) {
          for (var i = 0; i < response.files.length; i++) {
            var subFolder = response.files[i];
            foldersToProcess.push({ id: subFolder.id, path: currentFolder.path + "/" + subFolder.name });
          }
        }
      } catch (error) {
        Logger.log("❌ Errore durante la ricerca delle sottocartelle: " + error.message);
      }
    }

    return allSharedFiles;
  }

  var folderId = extractFolderId(folderUrl);
  Logger.log("🔍 Inizio della ricerca nelle sottocartelle della cartella con ID: " + folderId);

  var rootFolder = DriveApp.getFolderById(folderId);
  var rootFolderName = rootFolder.getName();

  var allSharedFiles = searchAllFolders(folderId, rootFolderName);

  Logger.log("✅ **Processo completato.**");
  Logger.log("📂 Totale file condivisi trovati con " + email + ": " + allSharedFiles.length);
  
  if (allSharedFiles.length > 0) {
    Logger.log("📄 **Elenco file condivisi:**");
    for (var i = 0; i < allSharedFiles.length; i++) {
      Logger.log("📌 " + allSharedFiles[i].name + " ➡ " + allSharedFiles[i].link);
    }
  } else {
    Logger.log("⚠ Nessun file condiviso trovato.");
  }

  return allSharedFiles;
}

function showResultsPage(email, folderUrl) {
  var sharedFiles = findFilesSharedWith(email, folderUrl);
  
  var htmlContent = "<html><head><title>Risultati Ricerca</title>";
  htmlContent += "<style>";
  htmlContent += "body { font-family: Arial, sans-serif; padding: 20px; }";
  htmlContent += "h2 { color: #333; }";
  htmlContent += "table { width: 100%; border-collapse: collapse; margin-top: 20px; }";
  htmlContent += "th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }";
  htmlContent += "th { background-color: #f4f4f4; cursor: pointer; }";
  htmlContent += "input { width: 100%; padding: 8px; margin-top: 10px; border: 1px solid #ddd; }";
  htmlContent += "</style>";
  htmlContent += "<script>";
  htmlContent += "function filterResults() {";
  htmlContent += "  var input = document.getElementById('searchInput').value.toLowerCase();";
  htmlContent += "  var rows = document.getElementsByTagName('tr');";
  htmlContent += "  for (var i = 1; i < rows.length; i++) {";
  htmlContent += "    var cell = rows[i].getElementsByTagName('td')[0];";
  htmlContent += "    if (cell) {";
  htmlContent += "      var textValue = cell.textContent || cell.innerText;";
  htmlContent += "      rows[i].style.display = textValue.toLowerCase().includes(input) ? '' : 'none';";
  htmlContent += "    }";
  htmlContent += "  }";
  htmlContent += "}";
  htmlContent += "</script></head><body>";
  htmlContent += "<h2>📂 File condivisi con <b>" + email + "</b></h2>";
  htmlContent += "<input type='text' id='searchInput' onkeyup='filterResults()' placeholder='🔎 Cerca file...'>";

  if (sharedFiles.length === 0) {
    htmlContent += "<p>⚠ Nessun file condiviso trovato.</p>";
  } else {
    htmlContent += "<table><tr><th>📄 File</th><th>🔗 Link</th></tr>";
    sharedFiles.forEach(function(file) {
      htmlContent += "<tr><td>" + file.name + "</td><td><a href='" + file.link + "' target='_blank'>Apri</a></td></tr>";
    });
    htmlContent += "</table>";
  }

  htmlContent += "</body></html>";

  var htmlOutput = HtmlService.createHtmlOutput(htmlContent)
    .setWidth(800)
    .setHeight(600);
  
  return htmlOutput;
}

function getResultsPage(email, folderUrl) {
  var template = HtmlService.createTemplateFromFile('ResultsPage');
  template.sharedFiles = findFilesSharedWith(email, folderUrl);
  template.email = email;

  return template.evaluate().getContent(); // 🔹 Ora restituisce il contenuto HTML corretto
}

function showInputDialog() {
  var htmlOutput = HtmlService.createHtmlOutputFromFile('InputDialog')
    .setWidth(400)
    .setHeight(300);
  
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "Inserisci Parametri");
}

function getWebAppExecUrl() {
  return PropertiesService.getScriptProperties().getProperty("WEB_APP_URL");
}

function setPickerConfig() {
  var properties = PropertiesService.getScriptProperties();
  properties.setProperties({
      "DEVELOPER_KEY": "AIzaSyDhv0r-LQTELQKDThW-I8lY1qEn5hPAnNs",
      "CLIENT_ID": "779738011216-thtj1fd1uaurbrj2l4afd363chjoicdp.apps.googleusercontent.com",
      "APP_ID": "findfilessharedwith-api"
  });
  Logger.log("✅ Configurazione salvata correttamente.");
}

function getOAuthToken() {
  var token = ScriptApp.getOAuthToken();
  Logger.log("OAuth Token: " + token); // 🔹 Controlla nei log
  return token;
}

function getPickerConfig() {
  var properties = PropertiesService.getScriptProperties();
  var config = {
      DEVELOPER_KEY: properties.getProperty("DEVELOPER_KEY"),
      CLIENT_ID: properties.getProperty("CLIENT_ID"),
      APP_ID: properties.getProperty("APP_ID")
  };
  
  if (!config.CLIENT_ID) {
      Logger.log("❌ Errore: CLIENT_ID non trovato nelle proprietà dello script.");
  }
  
  return config;
}