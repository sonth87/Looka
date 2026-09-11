// Phase-0 compatibility barrel for the pre-existing flat error-code table
// and CustomException. New modules should use the typed exception
// hierarchy in application.exception.ts + a module-scoped error-codes file
// registered into error-code.registry.ts instead of adding here — see
// docs/plans/backend-layering-plan.md §4.8 and §4.7.
export * from './code.constants.error';
export * from './custom.exception';
