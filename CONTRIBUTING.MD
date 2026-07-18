# Contributing to Unreal Engine VS Code Helper

Thank you for wanting to contribute! 🎉

## How to Contribute

1. Fork the repository
2. Create a new branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test them in VS Code
5. Open a Pull Request

## What to Contribute

- Bug fixes
- New features (IntelliSense improvements, better excludes, extra UE versions, etc.)
- Documentation / README improvements
- Performance tweaks

## Code Style

- Keep it simple and clean
- Use meaningful variable names
- Add comments where the logic is tricky

## Packaging / publish notes

- Package with `npm run vsix` (`@vscode/vsce`). The published VSIX is webpack-only (`dist/extension.js`); there are no runtime `dependencies`.
- Ignore `[DEP0040] punycode` / `[DEP0169] url.parse()` when running `cursor --install-extension …vsix` — those warnings are from Cursor’s CLI (and partly VS Code’s), not the extension. Do not block release on them.

## Questions?

Just open an issue or ask in the PR — I'm happy to help!

Made with ❤️ for the Unreal community.