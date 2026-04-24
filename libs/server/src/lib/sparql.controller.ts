import { Controller, Get, Post } from '@nestjs/common';

@Controller('sparql')
export class SparqlController {
  @Get()
  get(): { error: string } {
    return { error: 'not yet implemented' };
  }

  @Post()
  post(): { error: string } {
    return { error: 'not yet implemented' };
  }
}
