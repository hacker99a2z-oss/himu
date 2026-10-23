type InputHandler<TInput, TResult> = (context: { data: TInput }) => Promise<TResult>;

/**
 * Keeps the existing input validators and handler shapes while exposing them
 * through the standalone HTTP API instead of TanStack Start server functions.
 */
export function createServerFn(_options: { method: "GET" | "POST" }) {
  return {
    inputValidator<TInput>(validator: (input: unknown) => TInput) {
      return {
        handler<TResult>(handler: InputHandler<TInput, TResult>) {
          return async (context: { data: unknown }) =>
            handler({ data: validator(context.data) });
        },
      };
    },
    handler<TResult>(handler: () => Promise<TResult>) {
      return async () => handler();
    },
  };
}
