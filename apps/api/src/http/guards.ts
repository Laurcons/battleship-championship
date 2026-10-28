import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '@bsc/api-contract';
import { ACCESS_METADATA_KEY, type Access, type AuthedRequest } from './context.js';

/** Deny by default: a route must declare its access level, and the viewer must satisfy it. */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS_METADATA_KEY, [context.getHandler(), context.getClass()]);
    if (access === undefined) throw new ApiError('forbidden', 'This route has no access policy.');
    if (access === 'public') return true;
    const viewer = context.switchToHttp().getRequest<AuthedRequest>().viewer;
    if (!viewer) throw new ApiError('unauthenticated', 'You are not logged in.');
    if (access === 'participant' && viewer.role !== 'participant') throw new ApiError('forbidden', 'Only participants can do this.');
    if (access === 'admin' && viewer.role !== 'admin') throw new ApiError('forbidden', 'Only the admin can do this.');
    return true;
  }
}
