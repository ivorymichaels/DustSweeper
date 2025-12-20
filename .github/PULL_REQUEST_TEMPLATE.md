<!-- PR template -->
### Summary
Brief description of changes and why they are needed.

### Changes
- `scripts/deploy-testnets.js`: use ethers v6 provider/wallet; robust deployment flow
- `hardhat.config.js`: solidity settings adjusted; added `sepolia` network
- Tests: migrated to ethers v6 API

### How to test
1. `npm install`
2. `npx hardhat compile`
3. `npx hardhat test`

### Checklist
- [ ] Tests pass locally
- [ ] CI passes
- [ ] Documented any manual deploy steps

### Notes
If the repo owner wants me to push and open a PR I can supply the `gh` CLI command and commit message.
