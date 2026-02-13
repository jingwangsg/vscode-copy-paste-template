import * as vscode from "vscode";

type ReplacementKey =
  | "filePath"
  | "range"
  | "text"
  | "startLine"
  | "startChar"
  | "endLine"
  | "endChar";

const FUNCTION_SYMBOL_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
]);

const QUALIFIED_NAME_SYMBOL_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
]);

export type FunctionSymbolMatch = {
  symbol: vscode.DocumentSymbol;
  ancestors: vscode.DocumentSymbol[];
};

export type DefinitionBlock = {
  text: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
};

export function getConfiguration(key: string): string | undefined {
  return vscode.workspace
    .getConfiguration("copy-paste-template")
    .get<string>(key);
}

export function replacePlaceholder(
  template: string,
  placeholder: string,
  value: string
): string {
  // Ensure escaped placeholders are not replaced
  const regex = new RegExp(`(?<!\\\\){${placeholder}}`, "g");
  return template.replace(regex, value);
}

export function formatString(
  template: string,
  replacements: { [key in ReplacementKey]?: string }
): string {
  return Object.entries(replacements).reduce((formatted, [key, value]) => {
    return replacePlaceholder(formatted, key, value || "");
  }, template);
}

export function formatTemplate(
  key: string,
  replacements: { [key in ReplacementKey]?: string }
): string | undefined {
  const template = getConfiguration(key);
  if (!template) {
    vscode.window.showInformationMessage(`No template found for ${key}`);
    return undefined;
  }
  return formatString(template, replacements);
}

export function removeRootIndentation(text: string): string {
  const lines = text.split("\n");
  const rootIndentation = lines.reduce((min, line) => {
    const leadingWhitespace = line.match(/^(\s*)/)?.[0].length || 0;
    return line.trim() ? Math.min(min, leadingWhitespace) : min;
  }, Infinity);
  return lines.map((line) => line.slice(rootIndentation)).join("\n");
}

export function getActiveEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("No editor is active");
    return undefined;
  }
  return editor;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "copy-paste-template" is now active!');
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copy-paste-template.copySelection",
      copySelection
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("copy-paste-template.copyFile", copyFile)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copy-paste-template.copyFunctionWithParents",
      copyFunctionWithParents
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copy-paste-template.copyFunctionDefinitionWithParents",
      copyFunctionDefinitionWithParents
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copy-paste-template.copyFunctionQualifiedName",
      copyFunctionQualifiedName
    )
  );
}

export async function copySelection() {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const { document, selection } = editor;
  const text = document.getText(selection);
  const undentedText = getConfiguration("removeRootIndentation")
    ? removeRootIndentation(text)
    : text;
  const symbols = await getDocumentSymbols(document);
  const functionMatch = findInnermostFunctionSymbolAtPosition(
    symbols,
    selection.active
  );
  const textWithParents = functionMatch
    ? composeSelectionWithParentsText(document, functionMatch, undentedText)
    : undentedText;

  const replacements: { [key in ReplacementKey]?: string } = {
    filePath: vscode.workspace.asRelativePath(document.uri.fsPath),
    range: formatTemplate("rangeTemplate", {
      startLine: (selection.start.line + 1).toString(),
      startChar: (selection.start.character + 1).toString(),
      endLine: (selection.end.line + 1).toString(),
      endChar: (selection.end.character + 1).toString(),
    }),
    text: textWithParents,
  };

  const formattedText = formatTemplate("template", replacements);
  if (formattedText) {
    await vscode.env.clipboard.writeText(formattedText);
  }
}

function isDocumentSymbol(
  symbol: vscode.DocumentSymbol | vscode.SymbolInformation
): symbol is vscode.DocumentSymbol {
  return "children" in symbol;
}

function isSymbolInformation(
  symbol: vscode.DocumentSymbol | vscode.SymbolInformation
): symbol is vscode.SymbolInformation {
  return "location" in symbol;
}

function comparePositions(a: vscode.Position, b: vscode.Position): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.character - b.character;
}

function compareRangesForTree(a: vscode.Range, b: vscode.Range): number {
  const startCompare = comparePositions(a.start, b.start);
  if (startCompare !== 0) {
    return startCompare;
  }

  // For equal starts, wider ranges should come first so parents appear before children.
  return comparePositions(b.end, a.end);
}

function strictlyContainsRange(parent: vscode.Range, child: vscode.Range): boolean {
  if (!parent.contains(child.start) || !parent.contains(child.end)) {
    return false;
  }

  return parent.start.isBefore(child.start) || parent.end.isAfter(child.end);
}

function symbolInformationToDocumentSymbol(
  symbol: vscode.SymbolInformation
): vscode.DocumentSymbol {
  return new vscode.DocumentSymbol(
    symbol.name,
    symbol.containerName || "",
    symbol.kind,
    symbol.location.range,
    symbol.location.range
  );
}

function convertSymbolInformationToDocumentSymbols(
  symbols: vscode.SymbolInformation[]
): vscode.DocumentSymbol[] {
  const nodes = symbols
    .map(symbolInformationToDocumentSymbol)
    .sort((a, b) => compareRangesForTree(a.range, b.range));
  const roots: vscode.DocumentSymbol[] = [];
  const stack: vscode.DocumentSymbol[] = [];

  for (const node of nodes) {
    while (
      stack.length > 0 &&
      !strictlyContainsRange(stack[stack.length - 1].range, node.range)
    ) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }

  return roots;
}

export async function getDocumentSymbols(
  document: vscode.TextDocument
): Promise<vscode.DocumentSymbol[]> {
  const symbols = await vscode.commands.executeCommand<
    vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined
  >("vscode.executeDocumentSymbolProvider", document.uri);

  if (!symbols || symbols.length === 0) {
    return [];
  }

  if (symbols.every(isDocumentSymbol)) {
    return symbols;
  }

  if (symbols.every(isSymbolInformation)) {
    return convertSymbolInformationToDocumentSymbols(symbols);
  }

  return [];
}

function isNarrowerRange(a: vscode.Range, b: vscode.Range): boolean {
  if (a.start.isAfter(b.start)) {
    return true;
  }

  if (a.start.isBefore(b.start)) {
    return false;
  }

  if (a.end.isBefore(b.end)) {
    return true;
  }

  return false;
}

export function findInnermostFunctionSymbolAtPosition(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position
): FunctionSymbolMatch | undefined {
  let bestMatch: FunctionSymbolMatch | undefined;

  const visit = (
    symbol: vscode.DocumentSymbol,
    ancestors: vscode.DocumentSymbol[]
  ) => {
    if (!symbol.range.contains(position)) {
      return;
    }

    if (FUNCTION_SYMBOL_KINDS.has(symbol.kind)) {
      const candidate: FunctionSymbolMatch = { symbol, ancestors };
      if (
        !bestMatch ||
        isNarrowerRange(candidate.symbol.range, bestMatch.symbol.range)
      ) {
        bestMatch = candidate;
      }
    }

    const childAncestors = [...ancestors, symbol];
    for (const child of symbol.children) {
      visit(child, childAncestors);
    }
  };

  for (const symbol of symbols) {
    visit(symbol, []);
  }

  return bestMatch;
}

export function getTextByRange(
  document: vscode.TextDocument,
  range: vscode.Range
): string {
  return document.getText(range);
}

export function extractDefinitionHeaderLine(
  document: vscode.TextDocument,
  symbol: vscode.DocumentSymbol
): string {
  const definitionLine = getDefinitionLineNumber(symbol);
  const header = document.lineAt(definitionLine).text.trimEnd();
  if (header.trim().length > 0) {
    return header;
  }

  const symbolKind = vscode.SymbolKind[symbol.kind] || "Symbol";
  return `${symbolKind} ${symbol.name}`.trim();
}

export function getCopyRangeForFunctionSymbol(
  _document: vscode.TextDocument,
  symbol: vscode.DocumentSymbol
): vscode.Range {
  const { start, end } = symbol.range;
  return new vscode.Range(start.line, 0, end.line, end.character);
}

export function composeFunctionWithParentsText(
  document: vscode.TextDocument,
  ancestors: vscode.DocumentSymbol[],
  fnSymbol: vscode.DocumentSymbol
): string {
  const ancestorHeaders = ancestors.map((ancestor) =>
    extractDefinitionHeaderLine(document, ancestor)
  );
  const functionRange = getCopyRangeForFunctionSymbol(document, fnSymbol);
  const functionText = getTextByRange(document, functionRange);

  if (ancestorHeaders.length === 0) {
    return functionText;
  }

  return `${ancestorHeaders.join("\n")}\n${functionText}`;
}

export function composeSelectionWithParentsText(
  document: vscode.TextDocument,
  functionMatch: FunctionSymbolMatch,
  selectedText: string
): string {
  const parentSymbols = [...functionMatch.ancestors, functionMatch.symbol];
  if (parentSymbols.length === 0) {
    return selectedText;
  }

  const parentHeaders = parentSymbols.map((symbol) =>
    extractDefinitionHeaderLine(document, symbol)
  );
  return `${parentHeaders.join("\n")}\n${selectedText}`;
}

export function isNameSegmentSymbolKind(kind: vscode.SymbolKind): boolean {
  return QUALIFIED_NAME_SYMBOL_KINDS.has(kind);
}

export function composeQualifiedFunctionName(
  functionMatch: FunctionSymbolMatch
): string {
  return [...functionMatch.ancestors, functionMatch.symbol]
    .filter((symbol) => isNameSegmentSymbolKind(symbol.kind))
    .map((symbol) => symbol.name.trim())
    .filter((name) => name.length > 0)
    .join(".");
}

export function getDefinitionLineNumber(symbol: vscode.DocumentSymbol): number {
  if (symbol.selectionRange) {
    return symbol.selectionRange.start.line;
  }
  return symbol.range.start.line;
}

function buildSingleLineDefinitionBlock(
  document: vscode.TextDocument,
  symbol: vscode.DocumentSymbol
): DefinitionBlock {
  const definitionLine = getDefinitionLineNumber(symbol);
  const definitionText = document.lineAt(definitionLine).text.trimEnd();
  if (definitionText.trim().length > 0) {
    return {
      text: definitionText,
      startLine: definitionLine,
      startChar: 0,
      endLine: definitionLine,
      endChar: definitionText.length,
    };
  }

  const symbolKind = vscode.SymbolKind[symbol.kind] || "Symbol";
  const fallbackText = `${symbolKind} ${symbol.name}`.trim();
  return {
    text: fallbackText,
    startLine: definitionLine,
    startChar: 0,
    endLine: definitionLine,
    endChar: fallbackText.length,
  };
}

function findPythonDefinitionStartLine(
  document: vscode.TextDocument,
  symbol: vscode.DocumentSymbol,
  anchorLine: number
): number {
  let startLine = anchorLine;
  while (startLine > symbol.range.start.line) {
    const candidate = document.lineAt(startLine - 1).text.trim();
    if (!candidate.startsWith("@")) {
      break;
    }
    startLine -= 1;
  }
  return startLine;
}

function findPythonDefinitionEndLine(
  document: vscode.TextDocument,
  anchorLine: number,
  maxLine: number
): number {
  type PythonStringState = {
    quoteChar?: "'" | '"';
    tripleQuoted: boolean;
    escapeNext: boolean;
  };

  const scanPythonLine = (
    lineText: string,
    currentDepth: number,
    stringState: PythonStringState
  ): { depth: number; visibleCode: string } => {
    let depth = currentDepth;
    const visibleCodeChars: string[] = [];

    for (let index = 0; index < lineText.length; index += 1) {
      const char = lineText[index];

      if (stringState.quoteChar) {
        if (stringState.tripleQuoted) {
          if (
            lineText.slice(index, index + 3) ===
            stringState.quoteChar.repeat(3)
          ) {
            stringState.quoteChar = undefined;
            stringState.tripleQuoted = false;
            stringState.escapeNext = false;
            index += 2;
          }
          continue;
        }

        if (stringState.escapeNext) {
          stringState.escapeNext = false;
          continue;
        }

        if (char === "\\") {
          stringState.escapeNext = true;
          continue;
        }

        if (char === stringState.quoteChar) {
          stringState.quoteChar = undefined;
          stringState.escapeNext = false;
        }
        continue;
      }

      if (char === "#") {
        break;
      }

      if (char === '"' || char === "'") {
        const quoteChar = char as "'" | '"';
        const isTripleQuote = lineText.slice(index, index + 3) === char.repeat(3);
        stringState.quoteChar = quoteChar;
        stringState.tripleQuoted = isTripleQuote;
        stringState.escapeNext = false;
        if (isTripleQuote) {
          index += 2;
        }
        continue;
      }

      visibleCodeChars.push(char);
      if (char === "(" || char === "[" || char === "{") {
        depth += 1;
      } else if (char === ")" || char === "]" || char === "}") {
        depth = Math.max(0, depth - 1);
      }
    }

    return {
      depth,
      visibleCode: visibleCodeChars.join(""),
    };
  };

  let depth = 0;
  const stringState: PythonStringState = {
    quoteChar: undefined,
    tripleQuoted: false,
    escapeNext: false,
  };

  for (let line = anchorLine; line <= maxLine; line += 1) {
    const lineText = document.lineAt(line).text.trimEnd();
    const scanResult = scanPythonLine(lineText, depth, stringState);
    depth = scanResult.depth;

    if (
      depth === 0 &&
      !stringState.quoteChar &&
      scanResult.visibleCode.trimEnd().endsWith(":")
    ) {
      return line;
    }
  }

  return anchorLine;
}

function extractPythonDefinitionBlock(
  document: vscode.TextDocument,
  symbol: vscode.DocumentSymbol
): DefinitionBlock {
  const anchorLine = getDefinitionLineNumber(symbol);
  const maxLine = Math.min(symbol.range.end.line, document.lineCount - 1);
  const startLine = findPythonDefinitionStartLine(document, symbol, anchorLine);
  const endLine = findPythonDefinitionEndLine(document, anchorLine, maxLine);

  const lines: string[] = [];
  for (let line = startLine; line <= endLine; line += 1) {
    lines.push(document.lineAt(line).text.trimEnd());
  }

  const text = lines.join("\n");
  if (text.trim().length > 0) {
    const endChar = lines[lines.length - 1]?.length || 0;
    return { text, startLine, startChar: 0, endLine, endChar };
  }

  return buildSingleLineDefinitionBlock(document, symbol);
}

export function extractDefinitionBlock(
  document: vscode.TextDocument,
  symbol: vscode.DocumentSymbol
): DefinitionBlock {
  if (document.languageId === "python") {
    return extractPythonDefinitionBlock(document, symbol);
  }

  return buildSingleLineDefinitionBlock(document, symbol);
}

export function extractDefinitionLineText(
  document: vscode.TextDocument,
  symbol: vscode.DocumentSymbol
): string {
  return buildSingleLineDefinitionBlock(document, symbol).text;
}

export function composeFunctionDefinitionWithParentsBlocks(
  document: vscode.TextDocument,
  ancestors: vscode.DocumentSymbol[],
  fnSymbol: vscode.DocumentSymbol
): DefinitionBlock[] {
  const ancestorDefinitions = ancestors.map((ancestor) =>
    extractDefinitionBlock(document, ancestor)
  );
  const functionDefinition = extractDefinitionBlock(document, fnSymbol);
  return [...ancestorDefinitions, functionDefinition];
}

export function composeFunctionDefinitionWithParentsText(
  document: vscode.TextDocument,
  ancestors: vscode.DocumentSymbol[],
  fnSymbol: vscode.DocumentSymbol
): string {
  const blocks = composeFunctionDefinitionWithParentsBlocks(
    document,
    ancestors,
    fnSymbol
  );
  return blocks.map((block) => block.text).join("\n");
}

export async function copyFunctionWithParents() {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const { document, selection } = editor;
  const symbols = await getDocumentSymbols(document);
  const functionMatch = findInnermostFunctionSymbolAtPosition(
    symbols,
    selection.active
  );

  if (!functionMatch) {
    vscode.window.showInformationMessage("Unable to identify the current function");
    return;
  }

  const combinedText = composeFunctionWithParentsText(
    document,
    functionMatch.ancestors,
    functionMatch.symbol
  );
  const range = getCopyRangeForFunctionSymbol(document, functionMatch.symbol);

  const replacements: { [key in ReplacementKey]?: string } = {
    filePath: vscode.workspace.asRelativePath(document.uri.fsPath),
    range: formatTemplate("rangeTemplate", {
      startLine: (range.start.line + 1).toString(),
      startChar: (range.start.character + 1).toString(),
      endLine: (range.end.line + 1).toString(),
      endChar: (range.end.character + 1).toString(),
    }),
    text: combinedText,
  };

  const formattedText = formatTemplate("template", replacements);
  if (formattedText) {
    await vscode.env.clipboard.writeText(formattedText);
  }
}

export async function copyFunctionDefinitionWithParents() {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const { document, selection } = editor;
  const symbols = await getDocumentSymbols(document);
  const functionMatch = findInnermostFunctionSymbolAtPosition(
    symbols,
    selection.active
  );

  if (!functionMatch) {
    vscode.window.showInformationMessage("Unable to identify the current function");
    return;
  }

  const definitionBlocks = composeFunctionDefinitionWithParentsBlocks(
    document,
    functionMatch.ancestors,
    functionMatch.symbol
  );
  const combinedText = definitionBlocks.map((block) => block.text).join("\n");
  const startBlock = definitionBlocks.reduce((earliest, block) => {
    if (
      block.startLine < earliest.startLine ||
      (block.startLine === earliest.startLine &&
        block.startChar < earliest.startChar)
    ) {
      return block;
    }
    return earliest;
  });
  const functionBlock = definitionBlocks[definitionBlocks.length - 1];

  const replacements: { [key in ReplacementKey]?: string } = {
    filePath: vscode.workspace.asRelativePath(document.uri.fsPath),
    range: formatTemplate("rangeTemplate", {
      startLine: (startBlock.startLine + 1).toString(),
      startChar: (startBlock.startChar + 1).toString(),
      endLine: (functionBlock.endLine + 1).toString(),
      endChar: (functionBlock.endChar + 1).toString(),
    }),
    text: combinedText,
  };

  const formattedText = formatTemplate("template", replacements);
  if (formattedText) {
    await vscode.env.clipboard.writeText(formattedText);
  }
}

export async function copyFunctionQualifiedName() {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const { document, selection } = editor;
  const symbols = await getDocumentSymbols(document);
  const functionMatch = findInnermostFunctionSymbolAtPosition(
    symbols,
    selection.active
  );

  if (!functionMatch) {
    vscode.window.showInformationMessage("Unable to identify the current function");
    return;
  }

  const qualifiedName = composeQualifiedFunctionName(functionMatch);
  if (!qualifiedName) {
    vscode.window.showInformationMessage("Unable to identify the current function");
    return;
  }

  await vscode.env.clipboard.writeText(qualifiedName);
}

export function copyFile() {
  const editor = getActiveEditor();
  if (!editor) {
    return;
  }

  const text = editor.document.getText();
  const replacements: { [key in ReplacementKey]?: string } = {
    filePath: vscode.workspace.asRelativePath(editor.document.uri.fsPath),
    text: text,
    range: "",
  };

  const formattedText = formatTemplate("template", replacements);
  if (formattedText) {
    vscode.env.clipboard.writeText(formattedText);
  }
}

export function deactivate() {}
