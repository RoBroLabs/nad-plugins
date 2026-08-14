#!/usr/bin/env node
import { runScaffold } from './run-scaffold.mjs';

// A Widget is a schema-v2 App surface, not a third executable package kind.
runScaffold('app', process.argv.slice(2));
