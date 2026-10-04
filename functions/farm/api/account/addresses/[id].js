// DELETE /farm/api/account/addresses/:id — Delete a customer saved address
import { json, fail } from '../../_lib/http.js';
import { requireUser } from '../../_lib/auth.js';

export async function onRequestDelete({ request, env, params }) {
  const user = await requireUser(request, env);
  const addressId = Number(params.id);

  if (!Number.isInteger(addressId) || addressId <= 0) {
    fail(400, 'Invalid address ID.');
  }

  const result = await env.DB.prepare(
    'DELETE FROM farm_user_addresses WHERE id = ? AND user_id = ?'
  ).bind(addressId, user.id).run();

  if (result.meta.changes === 0) {
    fail(404, 'Address not found.');
  }

  return json({
    success: true,
    message: 'Address removed successfully.'
  });
}
