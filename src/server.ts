// server.ts
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  DidChangeConfigurationNotification
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let scssClasses: string[] = [];
let hasConfigurationCapability = false;
let scssFolder: string = "";

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['"', "'", ' ', '.'] // Added '.' for class chaining
      }
    }
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }

  updateSCSSClasses();
});

connection.onDidChangeConfiguration(() => {
  updateSCSSClasses();
});

async function updateSCSSClasses() {
  if (hasConfigurationCapability) {
    const config = await connection.workspace.getConfiguration('designSystemAssistant');
    scssFolder = config.scssFolder || "";
  }

  const workspaceFolders = await connection.workspace.getWorkspaceFolders();
  if (workspaceFolders) {
    const scssFiles = findScssFiles(workspaceFolders[0].uri);
    scssClasses = parseScssFiles(scssFiles);
    connection.console.log(`Found ${scssClasses.length} SCSS classes in ${scssFolder}`);
  }
}

connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    connection.console.log(`Providing ${scssClasses.length} completion items`);
    return scssClasses.map(className => ({
      label: className,
      kind: CompletionItemKind.Class
    }));
  }
);

function findScssFiles(workspaceUri: string): string[] {
  const workspacePath = workspaceUri.replace('file://', '');
  const searchPath = path.join(workspacePath, scssFolder);
  const scssFiles: string[] = [];

  connection.console.log(`Searching for SCSS files in: ${searchPath}`);

  function traverseDirectory(dirPath: string) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        traverseDirectory(filePath);
      } else if (path.extname(file) === '.scss') {
        scssFiles.push(filePath);
      }
    }
  }

  traverseDirectory(searchPath);
  connection.console.log(`Found ${scssFiles.length} SCSS files`);
  return scssFiles;
}


// server.ts (focusing on the parseScssFiles function and related helpers)

function parseScssFiles(files: string[]): string[] {
  const classNames: Set<string> = new Set();
  let variables: { [key: string]: any } = {};

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    
    // Parse variable declarations
    const variableRegex = /\$([a-zA-Z0-9_-]+):\s*\(([\s\S]*?)\)\s*!default;/g;
    let variableMatch;
    while ((variableMatch = variableRegex.exec(content)) !== null) {
      const [, variableName, variableContent] = variableMatch;
      variables[variableName] = parseVariableContent(variableContent);
      addClassesFromVariable(variableContent, classNames);
    }

    // Parse mixin calls
    const mixinCallRegex = /@include\s+([a-zA-Z0-9_-]+)\((.*?)\);/g;
    let mixinMatch;
    while ((mixinMatch = mixinCallRegex.exec(content)) !== null) {
      const [, mixinName, mixinArgs] = mixinMatch;
      processMixinCall(mixinName, mixinArgs, variables, classNames);
    }

    // Parse class declarations (from previous version)
    const classRegex = /\.([a-zA-Z0-9_-]+)\s*{/g;
    let classMatch;
    while ((classMatch = classRegex.exec(content)) !== null) {
      if (isValidClassName(classMatch[1])) {
        classNames.add(classMatch[1]);
      }
    }
  }

  return Array.from(classNames);
}

function parseVariableContent(content: string): any {
  const entries = content.split(',').map(entry => entry.trim());
  const result: { [key: string]: any } = {};
  entries.forEach(entry => {
    const [key, value] = entry.split(':').map(part => part.trim());
    result[key.replace(/['"]/g, '')] = value;
  });
  return result;
}

function addClassesFromVariable(content: string, classNames: Set<string>) {
  const entries = content.split(',').map(entry => entry.trim());
  entries.forEach(entry => {
    const [key] = entry.split(':');
    if (key) {
      const cleanKey = key.replace(/['"]/g, '').trim();
      if (isValidClassName(cleanKey)) {
        classNames.add(cleanKey);
      }
    }
  });
}

function processMixinCall(mixinName: string, mixinArgs: string, variables: { [key: string]: any }, classNames: Set<string>) {
  const args = mixinArgs.split(',').map(arg => arg.trim().replace(/['"]/g, ''));

  switch (mixinName) {
    case 'ds4-scale-class':
      if (args.length >= 3) {
        const [name, mapName, scalesName] = args;
        const map = variables[mapName];
        const scales = variables[scalesName];
        if (map && scales) {
          Object.keys(map).forEach(key => {
            Object.keys(scales).forEach(scaleKey => {
              const className = `${name}${key}-${scaleKey}`;
              if (isValidClassName(className)) {
                classNames.add(className);
              }
            });
          });
        }
      }
      break;
    case 'ds4-scale-font-class':
    case 'style-class':
      if (args.length >= 2) {
        const [, mapName] = args;
        const map = variables[mapName];
        if (map) {
          Object.keys(map).forEach(key => {
            if (isValidClassName(key)) {
              classNames.add(key);
            }
          });
        }
      }
      break;
    case 'ds4-scale-border-radius-class':
    case 'ds4-border-radius-class':
      if (args.length >= 1) {
        const mapName = args[0];
        const map = variables[mapName];
        if (map) {
          Object.keys(map).forEach(key => {
            if (isValidClassName(key)) {
              classNames.add(key);
            }
          });
        }
      }
      break;
  }
}

function isValidClassName(name: string): boolean {
  const invalidPatterns = [
    /^\$/,  // Starts with $
    /^#/,   // Starts with #
    /\$|%/,  // Contains $ or %
    /^[0-9]/,  // Starts with a number
    /^-/,   // Starts with a hyphen
    /\s/,   // Contains whitespace
    /[()]/,  // Contains parentheses
    /;$/,   // Ends with a semicolon
    /^[0-9]+(?:px|rem)$/,  // Just a size value
    /^\d+$/,  // Just a number
  ];

  return !invalidPatterns.some(pattern => pattern.test(name));
}

// function addClassesFromVariable(content: string, variableName: string, classNames: Set<string>) {
//   const variableRegex = new RegExp(`\\$${variableName}:\\s*\\((([\\s\\S]*?))\\)\\s*!default;`);
//   const match = variableRegex.exec(content);
//   if (match) {
//     const variableContent = match[1];
//     const entries = variableContent.split(',').map(entry => entry.trim());
//     entries.forEach(entry => {
//       const [key] = entry.split(':');
//       if (key) {
//         const cleanKey = key.replace(/['"]/g, '').trim();
//         if (isValidClassName(cleanKey)) {
//           classNames.add(cleanKey);
//         }
//       }
//     });
//   }
// }


documents.listen(connection);
connection.listen();