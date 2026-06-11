import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { Capability } from '@lms/shared';

import { CurrentUser, Requires } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import { EFFECTIVE_SCOPE_KEY, type AbacRequestContext } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { paginated, type PaginatedResult } from '../../core/http';
import { CreateProductConfigDto } from './dto/create-product-config.dto';
import { ListProductConfigsQueryDto } from './dto/list-product-configs.dto';
import { ProductConfigIdParam } from './dto/product-config-id-param.dto';
import { UpdateProductConfigDto } from './dto/update-product-config.dto';
import { PRODUCT_CONFIG_RESOURCE_TYPE } from './product-config.constants';
import {
  ProductConfigService,
  type CreateProductConfigResult,
  type UpdateProductConfigResult,
} from './product-config.service';
import type { ProductConfigListRow, ProductConfigRow } from './product-config.repository';

/** Fixes the ABAC resource type for `product_configs` (auth-matrix `scoped:false`). */
const productConfigResource = () => ({ resourceType: PRODUCT_CONFIG_RESOURCE_TYPE });

/**
 * FR-040 — product-configuration admin endpoints (`/api/v1/admin/products`). All
 * are protected by the global `JwtAuthGuard` + `AbacGuard` via
 * `@Requires('configuration')`; `product_configs` is org-scoped config
 * (auth-matrix `scoped:false`), so the resolver pins the ABAC resource type and
 * the service enforces the scope-A (ADMIN/HEAD) floor for every mutation. The
 * global interceptor wraps each return in the `{ data, meta, error }` envelope.
 *
 * There is deliberately NO approve endpoint here: a pending product-config version
 * is approved through FR-132 (`POST /admin/config/{id}/approve`), which resolves
 * this module's `product_config` activator to flip the draft to `active`.
 */
@Controller('admin/products')
@Requires(Capability.CONFIGURATION)
export class ProductConfigController {
  constructor(private readonly service: ProductConfigService) {}

  @Get()
  @Requires(Capability.CONFIGURATION, productConfigResource)
  async list(
    @Query(new ZodValidationPipe(ListProductConfigsQueryDto)) query: ListProductConfigsQueryDto,
  ): Promise<PaginatedResult<ProductConfigListRow[]>> {
    const result = await this.service.list(query);
    return paginated(result.data, result.pagination);
  }

  @Get(':id')
  @Requires(Capability.CONFIGURATION, productConfigResource)
  async get(
    @Param('id', new ZodValidationPipe(ProductConfigIdParam)) id: string,
  ): Promise<ProductConfigRow> {
    return this.service.get(id);
  }

  @Post()
  @HttpCode(201)
  @Requires(Capability.CONFIGURATION, productConfigResource)
  async create(
    @Body(new ZodValidationPipe(CreateProductConfigDto)) dto: CreateProductConfigDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<CreateProductConfigResult> {
    return this.service.createDraft(dto, user, req[EFFECTIVE_SCOPE_KEY]);
  }

  @Patch(':id')
  @Requires(Capability.CONFIGURATION, productConfigResource)
  async update(
    @Param('id', new ZodValidationPipe(ProductConfigIdParam)) id: string,
    @Body(new ZodValidationPipe(UpdateProductConfigDto)) dto: UpdateProductConfigDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<UpdateProductConfigResult> {
    return this.service.update(id, dto, user, req[EFFECTIVE_SCOPE_KEY]);
  }
}
