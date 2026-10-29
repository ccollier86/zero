/** Current presentation, deliberately separate from immutable retained evidence. */
export interface LoggingPerson { readonly id: string; readonly name: string; readonly username: string; readonly revision?: number }
export interface LoggingPeopleQuery { readonly search?: string; readonly after?: string; readonly limit?: number }
export interface LoggingPeoplePage { readonly items: readonly LoggingPerson[]; readonly nextCursor: string | null; readonly hasMore: boolean }
export interface LoggingTableChoice {
  /** Exact retained target type used by the query, not a SQL selector. */
  readonly type: string;
  readonly names: readonly string[];
  /** Current installation label; never part of a retained historical event. */
  readonly label?: string;
}
