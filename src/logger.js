const redactUrlLikeValues = (value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/([?&](?:token|key|signature|secret)=)[^&\s]+/gi, "$1[REDACTED]");
};

export const logJson = (payload) => {
  const safePayload = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, redactUrlLikeValues(value)])
  );

  console.log(JSON.stringify(safePayload));
};
