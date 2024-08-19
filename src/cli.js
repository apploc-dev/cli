import arg from 'arg';
import { input, password, confirm } from '@inquirer/prompts';
import fs, { existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createSpinner } from 'nanospinner';
import axios from 'axios';

const configFileName = 'apploc.config.json';
const apiUrl = 'https://api.apploc.dev/';

function parseArgumentsIntoOptions(rawArgs) {
    const args = arg(
        {
            '--id': String,
            '--secret': String,
            '--path': String,
            '-i': '--id',
            '-s': '--secret',
            '-p': '--path',
        },
        {
            argv: rawArgs.slice(2),
        }
    );

    return {
        id: args['--id'],
        secret: args['--secret'],
        path: args['--path'],
        command: args['_'][0],
    };
}

async function promptForMissingOptions(options) {
    if (options.command == 'init') {
        if (!options.id) {
            options.id = await input({ message: 'Enter project ID', required: true });
        }

        if (!options.secret) {
            options.secret = await password({ message: 'Enter project secret', required: true });
        }

        if (!options.path) {
            options.path = await input({
                message: 'Enter localization path',
                default: '/localization.json',
                required: true,
            });
        }
    }

    return options;
}

function printUsage() {
    console.log(`Usage: apploc <command> [options]

Commands:
  init     Initialize a new AppLoc project with the necessary configuration.
  update   Fetch and update the localization file based on the current configuration.
  help     Display this help message.

Options (only for 'init' command):
  -i, --id        Project ID.
  -s, --secret    Project secret.
  -p, --path      Path to the localization file (default: /localization.json).

Examples:
  apploc init --id myProjectID --secret myProjectSecret --path /path/to/localization.json
  apploc update`);
}

function findConfig(startDir) {
    let currentDir = startDir;

    while (true) {
        const configPath = path.join(currentDir, configFileName);

        if (fs.existsSync(configPath)) {
            return configPath;
        }

        const parentDir = path.dirname(currentDir);

        if (currentDir === parentDir) {
            break;
        }

        currentDir = parentDir;
    }

    return null;
}

function logError(message) {
    console.error(chalk.red('error: ') + message.toString().split('\n').join('\n       '));
}

function writeFile(path, contents) {
    return fs.writeFileSync(path, contents, { encoding: 'utf-8' });
}

function readFile(path) {
    return fs.readFileSync(path, { encoding: 'utf-8' });
}

export async function cli(args) {
    let options = parseArgumentsIntoOptions(args);

    if (!options.command) {
        process.exitCode = 1;
    }

    if (!options.command || options.command == 'help') {
        printUsage();
        return;
    }

    const workingDirectory = process.cwd();
    const configPath = findConfig(workingDirectory);

    if (options.command == 'init') {
        const newConfigPath = path.join(workingDirectory, configFileName);

        if (configPath) {
            console.log(chalk.yellow('!') + ' Found config at ' + chalk.bold(configPath));

            if (!(await confirm({ message: 'Do you still want to create ' + newConfigPath + '?', default: false }))) {
                return;
            }
        }

        options = await promptForMissingOptions(options);

        const config = { id: options.id, secret: options.secret, path: options.path };

        writeFile(newConfigPath, JSON.stringify(config));

        console.log(
            'Saved to ' +
                chalk.bold(newConfigPath) +
                '\nNow you can execute ' +
                chalk.bold('apploc update') +
                ' to check the validity of the config.'
        );
    } else if (options.command == 'update') {
        const configPath = findConfig(workingDirectory);

        if (!configPath) {
            logError(
                'unable to find ' +
                    configFileName +
                    ' in ' +
                    chalk.bold(workingDirectory) +
                    ' or any of its parents\ninitialize your project by executing ' +
                    chalk.bold('apploc init')
            );
            process.exitCode = 1;
            return;
        }

        let spinner;

        try {
            const config = JSON.parse(readFile(configPath));

            spinner = createSpinner('Fetching updates...').start();

            const response = (
                await axios.get(
                    apiUrl +
                        'getProjectData?' +
                        new URLSearchParams({
                            id: config.id,
                            secret: config.secret,
                        })
                )
            ).data;

            if (!response.ok) {
                throw response.message;
            }

            spinner.success();

            spinner = createSpinner('Creating optimized localizations...').start();

            let localizations = {};

            JSON.parse(response.data).keys.forEach((key) => {
                key.localizations.forEach((localization) => {
                    if (localizations[localization.code] == null) {
                        localizations[localization.code] = {};
                    }

                    localizations[localization.code][key.key] = localization.value;
                });
            });

            const newJson = JSON.stringify(localizations);

            spinner.success();

            const localizationPath = path.join(path.dirname(configPath), config.path);

            if (!existsSync(localizationPath) || readFile(localizationPath) != newJson) {
                spinner = createSpinner('Writing to ' + localizationPath + '...').start();

                writeFile(localizationPath, newJson);

                spinner.success();
            } else {
                console.log(chalk.green('✔') + ' Nothing has changed since the last version');
            }
        } catch (error) {
            if (spinner) {
                spinner.error();
            }

            logError(error);
            process.exitCode = 1;
            return;
        }
    } else {
        logError('unknown command: ' + options.command);
        process.exitCode = 1;
        return;
    }
}
