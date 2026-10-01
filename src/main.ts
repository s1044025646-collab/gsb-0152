import { runCli } from './cli.ts';

runCli(process.argv.slice(2))
  .then((code) => process.exitCode = code)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
