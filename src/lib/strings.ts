const ENGLISH_SHARED_STRINGS = {
  actions: {
    add: "Add",
    archive: "Archive",
    cancel: "Cancel",
    clear: "Clear",
    close: "Close",
    confirm: "Confirm",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    filter: "Filter",
    open: "Open",
    restore: "Restore",
    retry: "Retry",
    save: "Save",
    search: "Search",
    update: "Update",
  },
  fields: {
    amount: "Amount",
    date: "Date",
    fromDate: "From date",
    name: "Name",
    note: "Note",
    noteOptional: "Note (optional)",
    status: "Status",
    toDate: "To date",
  },
  payment: {
    amount: "Payment amount",
    date: "Payment date",
    mode: "Payment mode",
    selectMode: "Select mode",
    history: "Payment history",
    outstanding: "Outstanding",
    due: "Due",
    loadingHistory: "Loading payment history...",
    historyLoadError: "Could not load payment history.",
    noHistory: "No payments recorded yet.",
  },
  feedback: {
    loading: "Loading...",
    saving: "Saving...",
    unavailable: "Unavailable",
  },
} as const;

type WidenStringLeaves<TValue> = {
  readonly [Key in keyof TValue]: TValue[Key] extends string
    ? string
    : WidenStringLeaves<TValue[Key]>;
};

/**
 * Shape for future language dictionaries. This is intentionally only a typed
 * string structure, not a locale loader or runtime localization framework.
 */
export type AtlasSharedStrings = WidenStringLeaves<
  typeof ENGLISH_SHARED_STRINGS
>;

/** Canonical English wording shared across unrelated Atlas features. */
export const ATLAS_UI_STRINGS: AtlasSharedStrings = ENGLISH_SHARED_STRINGS;
