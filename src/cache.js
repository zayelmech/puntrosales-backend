import NodeCache from "node-cache";

export const catalogCache = new NodeCache({
  checkperiod: 60,
  useClones: false
});
