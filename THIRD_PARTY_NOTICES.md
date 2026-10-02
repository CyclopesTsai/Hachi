# Third-Party Notices

Hachi is released under the GNU Affero General Public License v3.0 or later (see `LICENSE`).
The third-party components below keep their own (permissive) licenses.

## Source code copied into this repository

### shadcn/ui

Files under `src/renderer/src/components/ui/` (and `cn()` in `src/renderer/src/lib/utils.ts`)
are based on components from [shadcn/ui](https://github.com/shadcn-ui/ui).

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## npm dependencies

Licenses of all packages shipped in the app are audited by `npm run check:licenses`
(allow-list: MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, Zlib).
The full license texts are generated with `node scripts/check-licenses.mjs --write`
into `out/THIRD_PARTY_LICENSES.txt` and bundled into the packaged app.

## Fonts and icons

- No font files are bundled; the UI uses the operating system's fonts.
- Icons: [Lucide](https://lucide.dev) (`lucide-react`, ISC License).
- The app logo is a temporary text placeholder created for Hachi.
