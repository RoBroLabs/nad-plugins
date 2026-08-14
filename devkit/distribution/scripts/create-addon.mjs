#!/usr/bin/env node
import { runScaffold } from './run-scaffold.mjs';

runScaffold('addon', process.argv.slice(2));
