#!/usr/bin/env node
import { runScaffold } from './run-scaffold.mjs';

runScaffold('app', process.argv.slice(2));
