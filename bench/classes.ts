/**
 * Every class string the suite renders, apart from uniqueClass(n). Kept apart
 * from suite.tsx so the stylesheet can be built without loading the suite
 * (see hermes/build.mjs).
 */
export const CLASSES = {
  root: "flex-1",
  header: "flex-1 mb-4 p-4 rounded-lg bg-gray",
  title: "text-lg text-typography font-bold text-center mb-1",
  container: "flex-row flex-wrap gap-2",
  item: "w-[32%] h-[100px] rounded-2xl bg-primary items-center justify-center",
  itemText: "text-typography font-bold text-2xl",
  flat: "p-4 rounded-2xl bg-red-500",
  toggleA: "p-4 rounded-2xl",
  toggleB: "p-4 bg-red-500",
  active: "p-4 active:opacity-50",
  media: "p-4 md:flex-row",
};
