import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import {
  replacePlaceholder,
  formatString,
  removeRootIndentation,
  getActiveEditor,
  copySelection,
  copyFile,
  copyFunctionWithParents,
  copyFunctionDefinitionWithParents,
  copyFunctionQualifiedName,
  __setClipboardWriterForTests,
  getConfiguration,
  formatTemplate,
  getDocumentSymbols,
  extractDefinitionBlock,
  findInnermostFunctionSymbolAtPosition,
  composeQualifiedFunctionName,
  extractDefinitionHeaderLine,
  getCopyRangeForFunctionSymbol,
  composeFunctionWithParentsText,
  getTextByRange,
} from "../extension";

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  teardown(() => {
    __setClipboardWriterForTests();
    sinon.restore();
  });

  function createSymbol(
    name: string,
    kind: vscode.SymbolKind,
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number
  ): vscode.DocumentSymbol {
    return new vscode.DocumentSymbol(
      name,
      "",
      kind,
      new vscode.Range(startLine, startChar, endLine, endChar),
      new vscode.Range(startLine, startChar, startLine, startChar)
    );
  }

  function createClipboardWriteStub(): sinon.SinonStub<[string], Promise<void>> {
    const clipboardWriteStub = sinon.stub<[string], Promise<void>>().resolves();
    __setClipboardWriterForTests((text: string) => clipboardWriteStub(text));
    return clipboardWriteStub;
  }

  test("replacePlaceholder should replace placeholders correctly", () => {
    const result = replacePlaceholder("Hello, {name}!", "name", "World");
    assert.strictEqual(result, "Hello, World!");
  });

  test("formatString should format string with replacements", () => {
    const template = "File: {filePath}, Line: {startLine}";
    const replacements = {
      filePath: "src/index.ts",
      startLine: "10",
    };
    const result = formatString(template, replacements);
    assert.strictEqual(result, "File: src/index.ts, Line: 10");
  });

  test("removeRootIndentation should remove leading spaces correctly", () => {
    const text = "    line1\n    line2\n      line3";
    const result = removeRootIndentation(text);
    assert.strictEqual(result, "line1\nline2\n  line3");
  });

  test("getActiveEditor should return active editor", () => {
    const mockEditor = {
      document: {
        uri: { fsPath: "src/index.ts" },
        getText: () => "sample text",
      },
      selection: new vscode.Selection(
        new vscode.Position(0, 0),
        new vscode.Position(1, 1)
      ),
    };

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);

    const editor = getActiveEditor();
    if (editor) {
      assert.strictEqual(editor.document.uri.fsPath, "src/index.ts");
    } else {
      assert.fail("No active editor");
    }
  });

  test("getConfiguration should return undefined for non-existent key", () => {
    const result = getConfiguration("nonExistentKey");
    assert.strictEqual(result, undefined);
  });

  test("formatTemplate should return undefined for non-existent template key", () => {
    const result = formatTemplate("nonExistentTemplate", {});
    assert.strictEqual(result, undefined);
  });

  test("copySelection should not throw an error when called", async () => {
    try {
      await copySelection();
      assert.ok(true);
    } catch (error) {
      assert.fail("copySelection threw an error");
    }
  });

  test("copySelection should prepend function chain headers when match exists", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "class Outer {\n  run() {\n    const x = 1;\n    return x;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 5, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 4, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(3, 0),
        new vscode.Position(3, 13)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return false;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "class Outer {\n  run() {\n    # ......\n    return x;"
    );
  });

  test("copySelection should preserve selected text indentation when prepending parents", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "namespace N {\n  class Outer {\n    run() {\n      const y = 1;\n      return y;\n    }\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 1, 2, 6, 3);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 2, 4, 5, 5);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(3, 0),
        new vscode.Position(4, 15)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "  class Outer {\n    run() {\n      const y = 1;\n      return y;"
    );
  });

  test("copySelection should fall back to selection text when no function matches", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "const value = 1;\n",
    });

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(0, 0),
        new vscode.Position(0, 16)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([]);
    const clipboardWriteStub = createClipboardWriteStub();
    const infoStub = sinon.stub(vscode.window, "showInformationMessage");
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(copiedText, "const value = 1;");
    assert.ok(infoStub.notCalled);
  });

  test("copySelection should keep range based on selection after prepending parents", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "class Outer {\n  run() {\n    const x = 1;\n    return x;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 5, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 4, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(3, 0),
        new vscode.Position(3, 13)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{range}|{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return false;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      ":4:1-4:14|class Outer {\n  run() {\n    # ......\n    return x;"
    );
  });

  test("copySelection should include full multiline python definition blocks", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content:
        "class LeRobotMixtureDataset(Dataset):\n    def __init__(\n        self,\n        data_mixture,\n    ):\n        datasets = []\n        dataset_sampling_weights = []\n        for dataset, weight in data_mixture:\n            datasets.append(dataset)\n            dataset_sampling_weights.append(weight)\n",
    });
    const selectedEndChar = document.lineAt(9).text.length;
    const classSymbol = createSymbol(
      "LeRobotMixtureDataset",
      vscode.SymbolKind.Class,
      0,
      0,
      9,
      selectedEndChar
    );
    const initSymbol = createSymbol(
      "__init__",
      vscode.SymbolKind.Method,
      1,
      4,
      9,
      selectedEndChar
    );
    classSymbol.children = [initSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(7, 0),
        new vscode.Position(9, selectedEndChar)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.ok(
      copiedText.includes(
        "class LeRobotMixtureDataset(Dataset):\n    def __init__(\n        self,\n        data_mixture,\n    ):"
      )
    );
    assert.ok(
      copiedText.includes(
        "\n        for dataset, weight in data_mixture:\n            datasets.append(dataset)\n            dataset_sampling_weights.append(weight)"
      )
    );
  });

  test("copySelection should include full python definition when symbol range is truncated", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content:
        "class LeRobotMixtureDataset(Dataset):\n    def __init__(\n        self,\n        data_mixture,\n    ):\n        self.balance_dataset_weights = balance_dataset_weights\n        self.balance_trajectory_weights = balance_trajectory_weights\n        self.seed = seed\n        self.training = training\n        self.allow_padding_at_end = allow_padding_at_end\n",
    });
    const classEndChar = document.lineAt(9).text.length;
    const initHeaderEndChar = document.lineAt(1).text.length;
    const classSymbol = createSymbol(
      "LeRobotMixtureDataset",
      vscode.SymbolKind.Class,
      0,
      0,
      9,
      classEndChar
    );
    const initSymbol = createSymbol(
      "__init__",
      vscode.SymbolKind.Method,
      1,
      4,
      1,
      initHeaderEndChar
    );
    classSymbol.children = [initSymbol];

    const mockEditor = {
      document,
      // Keep active on the truncated definition line so function matching still succeeds.
      selection: new vscode.Selection(
        new vscode.Position(9, classEndChar),
        new vscode.Position(1, 8)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.ok(
      copiedText.includes(
        "class LeRobotMixtureDataset(Dataset):\n    def __init__(\n        self,\n        data_mixture,\n    ):"
      )
    );
    assert.ok(
      copiedText.includes(
        "        self.balance_dataset_weights = balance_dataset_weights\n        self.balance_trajectory_weights = balance_trajectory_weights\n        self.seed = seed\n        self.training = training\n        self.allow_padding_at_end = allow_padding_at_end"
      )
    );
  });

  test("copySelection should still remove root indentation when no function matches", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "const items = {\n    first: 1,\n    second: 2,\n};\n",
    });
    const selectedEndChar = document.lineAt(2).text.length;

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(1, 0),
        new vscode.Position(2, selectedEndChar)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(copiedText, "first: 1,\nsecond: 2,");
  });

  test("copySelection should add only prefix omission marker when suffix has no omitted code lines", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  run() {\n    const before = 1;\n    return before;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 5, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 4, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(3, 0),
        new vscode.Position(4, 0)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return false;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "class Outer {\n  run() {\n    # ......\n    return before;\n"
    );
  });

  test("copySelection should add only suffix omission marker when prefix has no omitted code lines", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  run() {\n    return 1;\n    const after = 2;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 5, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 4, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(2, 0),
        new vscode.Position(2, 13)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return false;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "class Outer {\n  run() {\n    return 1;\n    # ......"
    );
  });

  test("copySelection should not add markers when only blank lines are omitted", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  run() {\n\n\n    return 1;\n\n\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 7, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 6, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(4, 0),
        new vscode.Position(4, 13)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return false;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(copiedText, "class Outer {\n  run() {\n    return 1;");
    assert.ok(!copiedText.includes("# ......"));
  });

  test("copySelection should not add markers for partial same-line omission", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  run() {\n    return value + 1;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 4, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 3, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(2, 11),
        new vscode.Position(2, 16)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return false;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(copiedText, "class Outer {\n  run() {\nvalue");
    assert.ok(!copiedText.includes("# ......"));
  });

  test("copySelection omission markers should only consider current function scope", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "class Outer {\n  before() {\n    return 0;\n  }\n\n  run() {\n    const only = 1;\n  }\n\n  after() {\n    return 2;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 12, 1);
    const beforeSymbol = createSymbol("before", vscode.SymbolKind.Method, 1, 2, 3, 3);
    const runSymbol = createSymbol("run", vscode.SymbolKind.Method, 5, 2, 7, 3);
    const afterSymbol = createSymbol("after", vscode.SymbolKind.Method, 9, 2, 11, 3);
    classSymbol.children = [beforeSymbol, runSymbol, afterSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(6, 0),
        new vscode.Position(6, 19)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return false;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copySelection();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(copiedText, "class Outer {\n  run() {\n    const only = 1;");
    assert.ok(!copiedText.includes("# ......"));
  });

  test("copyFile should not throw an error when called", () => {
    try {
      copyFile();
      assert.ok(true);
    } catch (error) {
      assert.fail("copyFile threw an error");
    }
  });

  test("composeQualifiedFunctionName should build class and function chain", () => {
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 10, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 9, 3);
    const innerFunctionSymbol = createSymbol(
      "inner",
      vscode.SymbolKind.Function,
      3,
      4,
      7,
      5
    );

    const qualifiedName = composeQualifiedFunctionName({
      ancestors: [classSymbol, methodSymbol],
      symbol: innerFunctionSymbol,
    });

    assert.strictEqual(qualifiedName, "Outer.run.inner");
  });

  test("composeQualifiedFunctionName should return function name for top-level function", () => {
    const functionSymbol = createSymbol("run", vscode.SymbolKind.Function, 0, 0, 1, 1);

    const qualifiedName = composeQualifiedFunctionName({
      ancestors: [],
      symbol: functionSymbol,
    });

    assert.strictEqual(qualifiedName, "run");
  });

  test("composeQualifiedFunctionName should ignore non class and function ancestors", () => {
    const namespaceSymbol = createSymbol(
      "MyNamespace",
      vscode.SymbolKind.Namespace,
      0,
      0,
      10,
      1
    );
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 1, 0, 9, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 2, 2, 8, 3);

    const qualifiedName = composeQualifiedFunctionName({
      ancestors: [namespaceSymbol, classSymbol],
      symbol: methodSymbol,
    });

    assert.strictEqual(qualifiedName, "Outer.run");
  });

  test("copyFunctionQualifiedName should copy Class.Function for class method", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  run() {\n    return 1;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 4, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 3, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(2, 4),
        new vscode.Position(2, 4)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    const infoStub = sinon.stub(vscode.window, "showInformationMessage");

    await copyFunctionQualifiedName();

    assert.ok(clipboardWriteStub.calledOnceWithExactly("`Outer.run`"));
    assert.ok(infoStub.notCalled);
  });

  test("copyFunctionQualifiedName should copy full chain for nested class and function", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "class Outer {\n  run() {\n    function inner() {\n      return 1;\n    }\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 6, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 5, 3);
    const innerFunctionSymbol = createSymbol(
      "inner",
      vscode.SymbolKind.Function,
      2,
      4,
      4,
      5
    );
    classSymbol.children = [methodSymbol];
    methodSymbol.children = [innerFunctionSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(3, 8),
        new vscode.Position(3, 8)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();

    await copyFunctionQualifiedName();

    assert.ok(clipboardWriteStub.calledOnceWithExactly("`Outer.run.inner`"));
  });

  test("copyFunctionQualifiedName should copy top-level function name", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "function run() {\n  return 1;\n}\n",
    });
    const functionSymbol = createSymbol("run", vscode.SymbolKind.Function, 0, 0, 2, 1);

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(1, 2),
        new vscode.Position(1, 2)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([functionSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();

    await copyFunctionQualifiedName();

    assert.ok(clipboardWriteStub.calledOnceWithExactly("`run`"));
  });

  test("copyFunctionQualifiedName should show info and not copy when no function matches", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  value = 1;\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 2, 1);

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(1, 6),
        new vscode.Position(1, 6)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    const infoStub = sinon.stub(vscode.window, "showInformationMessage");

    await copyFunctionQualifiedName();

    assert.ok(clipboardWriteStub.notCalled);
    assert.ok(
      infoStub.calledWith("Unable to identify the current function")
    );
  });

  test("copyFunctionQualifiedName should use selection.active as anchor", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "class Outer {\n  first() { return 1; }\n  second() { return 2; }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 3, 1);
    const firstMethodSymbol = createSymbol(
      "first",
      vscode.SymbolKind.Method,
      1,
      2,
      1,
      23
    );
    const secondMethodSymbol = createSymbol(
      "second",
      vscode.SymbolKind.Method,
      2,
      2,
      2,
      24
    );
    classSymbol.children = [firstMethodSymbol, secondMethodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(1, 8),
        new vscode.Position(2, 9)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();

    await copyFunctionQualifiedName();

    assert.ok(clipboardWriteStub.calledOnceWithExactly("`Outer.second`"));
  });

  test("getDocumentSymbols should convert SymbolInformation results to nested symbols", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  run() {\n    return 1;\n  }\n}\n",
    });
    const classInfo = new vscode.SymbolInformation(
      "Outer",
      vscode.SymbolKind.Class,
      "",
      new vscode.Location(document.uri, new vscode.Range(0, 0, 4, 1))
    );
    const methodInfo = new vscode.SymbolInformation(
      "run",
      vscode.SymbolKind.Method,
      "Outer",
      new vscode.Location(document.uri, new vscode.Range(1, 2, 3, 3))
    );

    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classInfo, methodInfo]);

    const symbols = await getDocumentSymbols(document);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0].name, "Outer");
    assert.strictEqual(symbols[0].children.length, 1);
    assert.strictEqual(symbols[0].children[0].name, "run");
  });

  test("findInnermostFunctionSymbolAtPosition should find class method", () => {
    const classSymbol = createSymbol("Greeter", vscode.SymbolKind.Class, 0, 0, 6, 1);
    const methodSymbol = createSymbol("sayHi", vscode.SymbolKind.Method, 1, 2, 5, 3);
    classSymbol.children = [methodSymbol];

    const result = findInnermostFunctionSymbolAtPosition(
      [classSymbol],
      new vscode.Position(2, 4)
    );

    assert.ok(result);
    assert.strictEqual(result?.symbol, methodSymbol);
    assert.deepStrictEqual(result?.ancestors, [classSymbol]);
  });

  test("findInnermostFunctionSymbolAtPosition should prefer innermost nested function", () => {
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 10, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 9, 3);
    const innerFunctionSymbol = createSymbol(
      "inner",
      vscode.SymbolKind.Function,
      3,
      4,
      7,
      5
    );
    classSymbol.children = [methodSymbol];
    methodSymbol.children = [innerFunctionSymbol];

    const result = findInnermostFunctionSymbolAtPosition(
      [classSymbol],
      new vscode.Position(4, 6)
    );

    assert.ok(result);
    assert.strictEqual(result?.symbol, innerFunctionSymbol);
    assert.deepStrictEqual(result?.ancestors, [classSymbol, methodSymbol]);
  });

  test("extractDefinitionHeaderLine should trim trailing whitespace", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Container {   \n  method() {\n    return 1;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Container", vscode.SymbolKind.Class, 0, 0, 4, 1);

    const header = extractDefinitionHeaderLine(document, classSymbol);
    assert.strictEqual(header, "class Container {");
  });

  test("extractDefinitionHeaderLine should prefer selectionRange line", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "// not definition\n  class Container {\n    method() {\n      return 1;\n    }\n  }\n",
    });
    const classSymbol = createSymbol("Container", vscode.SymbolKind.Class, 0, 0, 5, 3);
    classSymbol.selectionRange = new vscode.Range(1, 2, 1, 18);

    const header = extractDefinitionHeaderLine(document, classSymbol);
    assert.strictEqual(header, "  class Container {");
  });

  test("extractDefinitionBlock should include decorator outside symbol range start", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content:
        "class Outer:\n    @cache\n    def run(\n        self,\n    ):\n        return 1\n",
    });
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 2, 4, 2, 11);
    methodSymbol.selectionRange = new vscode.Range(2, 4, 2, 7);

    const definitionBlock = extractDefinitionBlock(document, methodSymbol);

    assert.strictEqual(
      definitionBlock.text,
      "    @cache\n    def run(\n        self,\n    ):"
    );
  });

  test("getCopyRangeForFunctionSymbol should expand start when prefix is whitespace", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content: "class Outer:\n    def run(self):\n        return 1\n",
    });
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 4, 2, 16);

    const range = getCopyRangeForFunctionSymbol(document, methodSymbol);

    assert.strictEqual(range.start.line, 1);
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.line, 2);
    assert.strictEqual(range.end.character, 16);
  });

  test("getCopyRangeForFunctionSymbol should start at column 0 even when prefix has non-whitespace", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content: "label: def run(self):\n    return 1\n",
    });
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 0, 7, 1, 12);

    const range = getCopyRangeForFunctionSymbol(document, methodSymbol);

    assert.strictEqual(range.start.line, 0);
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.line, 1);
    assert.strictEqual(range.end.character, 12);
  });

  test("composeFunctionWithParentsText should prepend ancestor headers", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Container {\n  method() {\n    return 1;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Container", vscode.SymbolKind.Class, 0, 0, 4, 1);
    const methodSymbol = createSymbol("method", vscode.SymbolKind.Method, 1, 2, 3, 3);

    const methodText = getTextByRange(document, methodSymbol.range);
    assert.ok(methodText.includes("return 1;"));

    const result = composeFunctionWithParentsText(
      document,
      [classSymbol],
      methodSymbol
    );

    assert.strictEqual(
      result,
      "class Container {\n  method() {\n    return 1;\n  }"
    );
  });

  test("composeFunctionWithParentsText should preserve parent indent from selectionRange line", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "// not definition\n  class Container {\n    method() {\n      return 1;\n    }\n  }\n",
    });
    const classSymbol = createSymbol("Container", vscode.SymbolKind.Class, 0, 0, 5, 3);
    classSymbol.selectionRange = new vscode.Range(1, 2, 1, 18);
    const methodSymbol = createSymbol("method", vscode.SymbolKind.Method, 2, 4, 4, 5);

    const result = composeFunctionWithParentsText(
      document,
      [classSymbol],
      methodSymbol
    );

    assert.strictEqual(
      result,
      "  class Container {\n    method() {\n      return 1;\n    }"
    );
  });

  test("copyFunctionWithParents should copy ancestor headers with function text", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  run() {\n    return 1;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 4, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 3, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(2, 4),
        new vscode.Position(2, 4)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "class Outer {\n  run() {\n    return 1;\n  }"
    );
  });

  test("copyFunctionWithParents should preserve indented parent header when removeRootIndentation is enabled", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "class Outer {\n  run() {\n    function inner() {\n      return 1;\n    }\n  }\n}\n",
    });
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 5, 3);
    const innerFunctionSymbol = createSymbol(
      "inner",
      vscode.SymbolKind.Function,
      2,
      4,
      4,
      5
    );
    methodSymbol.children = [innerFunctionSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(3, 8),
        new vscode.Position(3, 8)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([methodSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "  run() {\n    function inner() {\n      return 1;\n    }"
    );
  });

  test("copyFunctionWithParents should use adjusted range and preserve indented function definition", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content:
        "class ShardedMixtureDataset:\n    def finish_cache_shard(self):\n        return self._cache_job.result()\n",
    });
    const classSymbol = createSymbol("ShardedMixtureDataset", vscode.SymbolKind.Class, 0, 0, 2, 39);
    const methodSymbol = createSymbol(
      "finish_cache_shard",
      vscode.SymbolKind.Method,
      1,
      4,
      2,
      39
    );
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(2, 12),
        new vscode.Position(2, 12)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{range}|{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.ok(copiedText.startsWith(":2:1-3:40|"));
    assert.ok(copiedText.includes("class ShardedMixtureDataset:"));
    assert.ok(copiedText.includes("    def finish_cache_shard(self):"));
  });

  test("copyFunctionWithParents should include decorator and keep adjusted start char", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content: "class Outer:\n    @cache\n    def run(self):\n        return 1\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 3, 16);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 4, 3, 16);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(3, 8),
        new vscode.Position(3, 8)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{range}|{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.ok(copiedText.startsWith(":2:1-4:17|"));
    assert.ok(copiedText.includes("class Outer:"));
    assert.ok(copiedText.includes("    @cache\n    def run(self):"));
  });

  test("copyFunctionWithParents should show info and not copy when no function matches", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  value = 1;\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 2, 1);

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(1, 4),
        new vscode.Position(1, 4)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    const infoStub = sinon.stub(vscode.window, "showInformationMessage");

    await copyFunctionWithParents();

    assert.ok(clipboardWriteStub.notCalled);
    assert.ok(
      infoStub.calledWith("Unable to identify the current function")
    );
  });

  test("copyFunctionDefinitionWithParents should copy only parent and function definitions", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  run() {\n    return 1;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 4, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 3, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(2, 4),
        new vscode.Position(2, 4)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        if (key === "removeRootIndentation") {
          return true;
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(copiedText, "class Outer {\n  run() {");
    assert.ok(!copiedText.includes("return 1;"));
  });

  test("copyFunctionDefinitionWithParents should include nested parent definitions", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "class Outer {\n  run() {\n    function inner() {\n      return 1;\n    }\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 6, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 5, 3);
    const innerFunctionSymbol = createSymbol(
      "inner",
      vscode.SymbolKind.Function,
      2,
      4,
      4,
      5
    );
    classSymbol.children = [methodSymbol];
    methodSymbol.children = [innerFunctionSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(3, 8),
        new vscode.Position(3, 8)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "class Outer {\n  run() {\n    function inner() {"
    );
    assert.ok(!copiedText.includes("return 1;"));
  });

  test("copyFunctionDefinitionWithParents should use envelope range for parent and function definitions", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  run() {\n    return 1;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 4, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 3, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(2, 4),
        new vscode.Position(2, 4)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{range}|{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.ok(copiedText.startsWith(":1:1-2:10|"));
    assert.ok(copiedText.includes("class Outer {\n  run() {"));
    assert.ok(!copiedText.includes("return 1;"));
  });

  test("copyFunctionDefinitionWithParents should include multiline python function signature", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content:
        "class Outer:\n    def run(\n        self,\n        value,\n    ):\n        return value\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 5, 20);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 4, 5, 20);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(4, 4),
        new vscode.Position(4, 4)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "class Outer:\n    def run(\n        self,\n        value,\n    ):"
    );
    assert.ok(!copiedText.includes("return value"));
  });

  test("copyFunctionDefinitionWithParents should ignore bracket characters inside python strings", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content:
        "class Outer:\n    def run(\n        pattern=\"(\",\n        value=1,\n    ):\n        return value\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 5, 20);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 4, 5, 20);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(4, 4),
        new vscode.Position(4, 4)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "class Outer:\n    def run(\n        pattern=\"(\",\n        value=1,\n    ):"
    );
    assert.ok(!copiedText.includes("return value"));
  });

  test("copyFunctionDefinitionWithParents should include multiline parent and function definitions", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content:
        "class Outer(\n    Base,\n):\n    def run(\n        self,\n    ):\n        return 1\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 6, 16);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 3, 4, 6, 16);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(4, 8),
        new vscode.Position(4, 8)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "class Outer(\n    Base,\n):\n    def run(\n        self,\n    ):"
    );
    assert.ok(!copiedText.includes("return 1"));
  });

  test("copyFunctionDefinitionWithParents should include decorators in python definitions", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content:
        "class Outer:\n    @cache\n    def run(\n        self,\n    ):\n        return 1\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 5, 16);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 4, 5, 16);
    methodSymbol.selectionRange = new vscode.Range(2, 4, 2, 7);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(4, 8),
        new vscode.Position(4, 8)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(
      copiedText,
      "class Outer:\n    @cache\n    def run(\n        self,\n    ):"
    );
  });

  test("copyFunctionDefinitionWithParents should use multiline envelope range in python", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content:
        "class Outer:\n    def run(\n        self,\n        value,\n    ):\n        return value\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 5, 20);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 4, 5, 20);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(4, 4),
        new vscode.Position(4, 4)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{range}|{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.ok(copiedText.startsWith(":1:1-5:7|"));
    assert.ok(
      copiedText.includes(
        "class Outer:\n    def run(\n        self,\n        value,\n    ):"
      )
    );
    assert.ok(!copiedText.includes("return value"));
  });

  test("copyFunctionDefinitionWithParents should keep single-line behavior for non-python", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content:
        "class Outer {\n  run(\n    value: number,\n  ) {\n    return value;\n  }\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 6, 1);
    const methodSymbol = createSymbol("run", vscode.SymbolKind.Method, 1, 2, 5, 3);
    classSymbol.children = [methodSymbol];

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(2, 6),
        new vscode.Position(2, 6)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    sinon.stub(vscode.workspace, "getConfiguration").returns({
      get: (key: string) => {
        if (key === "template") {
          return "{text}";
        }
        if (key === "rangeTemplate") {
          return ":{startLine}:{startChar}-{endLine}:{endChar}";
        }
        return undefined;
      },
    } as vscode.WorkspaceConfiguration);

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.calledOnce);
    const copiedText = clipboardWriteStub.firstCall.args[0] as string;
    assert.strictEqual(copiedText, "class Outer {\n  run(");
    assert.ok(!copiedText.includes("value: number"));
    assert.ok(!copiedText.includes("return value"));
  });

  test("copyFunctionDefinitionWithParents should show info and not copy when no function matches", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "class Outer {\n  value = 1;\n}\n",
    });
    const classSymbol = createSymbol("Outer", vscode.SymbolKind.Class, 0, 0, 2, 1);

    const mockEditor = {
      document,
      selection: new vscode.Selection(
        new vscode.Position(1, 4),
        new vscode.Position(1, 4)
      ),
    } as unknown as vscode.TextEditor;

    sinon.stub(vscode.window, "activeTextEditor").value(mockEditor);
    sinon
      .stub(vscode.commands, "executeCommand")
      .withArgs("vscode.executeDocumentSymbolProvider", document.uri)
      .resolves([classSymbol]);
    const clipboardWriteStub = createClipboardWriteStub();
    const infoStub = sinon.stub(vscode.window, "showInformationMessage");

    await copyFunctionDefinitionWithParents();

    assert.ok(clipboardWriteStub.notCalled);
    assert.ok(
      infoStub.calledWith("Unable to identify the current function")
    );
  });
});
