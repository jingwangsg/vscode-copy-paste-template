# Copy Templater

Extension designed to conveniently template code snippets, particularly for Language Learning Model (LLM) input, facilitating quick formatting and copying of delimitted code snippets and contextual information like the file path.

## Usage

To use the extension, select a snippert and use the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) and run the "Copy Formatted Selection" / `copy-paste-template.copySelection` command. This command prepends all parent definition blocks in the current function chain (outer to inner, including the current function definition) before the selected text. For Python, this includes multiline signatures and decorators, and tolerates truncated symbol ranges by scanning forward until the definition signature closes with `:`. If code lines are omitted before or after the selected lines inside the current function, it inserts `# ......` to indicate omitted content. If no function chain is found at the active cursor position, it falls back to copying only the selection.

Alternatively, run the "Copy Formatted Entire File" / `copy-paste-template.copyFile` to copy the entire file.

You can also run "Copy Formatted Function With Parents" / `copy-paste-template.copyFunctionWithParents` while your cursor is inside a function or method. This copies all ancestor definition headers (outer to inner) followed by the full function body, preserving the original source indentation. For Python, function content is wrapped in fenced code blocks with the `python` language tag, or the template's first bare fence is upgraded to include `python`. If no function is found at the cursor, the extension shows an informational message and does not modify the clipboard.

You can run "Copy Formatted Function Definition With Parents" / `copy-paste-template.copyFunctionDefinitionWithParents` to copy only parent definition blocks plus the current function definition block (supports multi-line signatures in Python), without copying the function body. For Python, output uses the same fenced-code rule with the `python` language tag.

You can run "Copy Function Qualified Name" / `copy-paste-template.copyFunctionQualifiedName` to copy the qualified function name at the active cursor wrapped in backticks (for example, `` `Outer.run` ``), including full class/function chain segments. This command writes plain text (no template formatting). If no function is found, it shows an informational message and does not modify the clipboard.

## Features

-   Automatically formats code snippets with markdown to ensure compatibility with platforms requiring formatted input.
-   Includes contextual information like file paths in the copied content, making it easier to reference the source in collaborative environments.
-   Offers customizable templates that can be tailored through VSCode settings to match specific formatting requirements.

## Requirements

No additional requirements or dependencies are needed for this extension beyond the standard VSCode installation.

## Extension Settings

You can customize the functionality of "Copy Templater" through the settings accessed from `File > Preferences > Settings`. Configure templates and other options under the `copy-paste-template` configuration key.

-   `copy-paste-template.template`: Defines the format of the text that is copied to the clipboard. You can customize this template using placeholders for specific pieces of information:
    
    -   `{filePath}`: Inserts the relative path of the file.
    -   `{range}`: Includes the range of the selection, formatted according to the `copy-paste-template.rangeTemplate`.
    -   `{text}`: Inserts the selected text. The default template formats the file path and selection range on separate lines above the selected text, which is enclosed in markdown code blocks.
-   `copy-paste-template.rangeTemplate`: Specifies how to format the range of the selection in the copied text, using placeholders:
    
    -   `{startLine}`: Line number where the selection starts.
    -   `{endLine}`: Line number where the selection ends.
    -   `{startChar}`: Character position where the selection starts.
    -   `{endChar}`: Character position where the selection ends.
    
-   `copy-paste-template.removeRootIndentation`: If enabled, removes any root indentation from copied selections (`copy-paste-template.copySelection`). The default is set to `true`. For `copy-paste-template.copySelection`, this setting is applied when no function chain is found at the cursor. When function parent definitions are prepended, the selected text keeps its original source indentation. `copy-paste-template.copyFunctionWithParents` and `copy-paste-template.copyFunctionDefinitionWithParents` always preserve source indentation.

The default template is set to output a markdown code block prefixed by the file path and range. You could easily change the template to use different formats, e.g. XML.

The default range template outputs the range in the format `:{startLine}:{startChar}-{endLine}:{endChar}`, indicating the start and end points of the selection. You may want to remove the character indices.

## Known Issues

No known issues at this time.

## Release Notes

### 0.0.1

Initial release

## Following extension guidelines

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
