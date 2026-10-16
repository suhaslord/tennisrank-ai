async function allRows(context, rest, path) {
  const collected = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await rest(context, path + '&limit=1000&offset=' + offset);
    if (!result.response.ok) return result;
    if (!Array.isArray(result.payload)) throw new Error("The database returned invalid paginated data.");
    collected.push(...result.payload);
    if (result.payload.length < 1000) return { ...result, payload: collected };
  }
}

module.exports = { allRows };
