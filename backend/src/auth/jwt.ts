import jwt from 'jsonwebtoken';

export function signUserToken(user: { id: string; email?: string; workspace_id?: string }) {
  const payload = {
    id: user.id,
    email: user.email,
    workspace_id: user.workspace_id || 'default'
  };

  return jwt.sign(payload, process.env.JWT_SECRET ?? 'test_secret', {
    expiresIn: '1h'
  });
}
