# Third-party notices

Turnplay Arena uses the direct open-source dependencies listed below. The version column records the exact installed version from `package-lock.json`; “role” describes how this project uses the package, not how npm classifies it. Each linked file under `licenses/` is a verbatim copy of the license text distributed with that installed package version.

This notice is not a license for the original Turnplay Arena source code. No project-level license has been selected by the owner.

## Application and server dependencies

| Package | Installed version | Role | Package license / distributed notice | Verbatim text |
| --- | --- | --- | --- | --- |
| `@modelcontextprotocol/ext-apps` | 1.0.1 | Server runtime | Package metadata says MIT; the distributed transition notice also contains Apache-2.0, MIT, and CC-BY-4.0 text | [`licenses/modelcontextprotocol-ext-apps-LICENSE.txt`](licenses/modelcontextprotocol-ext-apps-LICENSE.txt) |
| `@modelcontextprotocol/sdk` | 1.26.0 | Server runtime | MIT | [`licenses/modelcontextprotocol-sdk-LICENSE.txt`](licenses/modelcontextprotocol-sdk-LICENSE.txt) |
| `chess.js` | 1.4.0 | Server runtime and browser bundle | BSD-2-Clause | [`licenses/chess.js-LICENSE.txt`](licenses/chess.js-LICENSE.txt) |
| `express` | 5.2.1 | Server runtime | MIT | [`licenses/express-LICENSE.txt`](licenses/express-LICENSE.txt) |
| `zod` | 3.25.76 | Server runtime | MIT | [`licenses/zod-LICENSE.txt`](licenses/zod-LICENSE.txt) |
| `react` | 18.3.1 | Browser bundle | MIT | [`licenses/react-LICENSE.txt`](licenses/react-LICENSE.txt) |
| `react-dom` | 18.3.1 | Browser bundle | MIT | [`licenses/react-dom-LICENSE.txt`](licenses/react-dom-LICENSE.txt) |

The MCP SDK's `zod-to-json-schema` dependency also installs Zod 4.4.3 transitively. Its installed MIT license text is byte-identical to the direct Zod 3.25.76 license copied above.

## Widget build dependencies

These packages build the single-file browser widget. They are not contacted as external services by the running widget.

| Package | Installed version | Role | Package license / distributed notice | Verbatim text |
| --- | --- | --- | --- | --- |
| `@vitejs/plugin-react` | 4.7.0 | Build-time React transform | MIT | [`licenses/vitejs-plugin-react-LICENSE.txt`](licenses/vitejs-plugin-react-LICENSE.txt) |
| `vite` | 7.3.6 | Widget bundler | MIT plus notices for dependencies bundled by Vite | [`licenses/vite-LICENSE.md`](licenses/vite-LICENSE.md) |
| `vite-plugin-singlefile` | 2.3.0 | Single-file widget bundling | MIT | [`licenses/vite-plugin-singlefile-LICENSE.txt`](licenses/vite-plugin-singlefile-LICENSE.txt) |

Transitive dependencies remain subject to their own licenses. The installed npm package tree and `package-lock.json` identify the resolved versions used to build and run this revision.
