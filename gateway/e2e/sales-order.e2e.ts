// @covers gateway/src/public-api/public-api.controller.ts
import { describeOrderDocumentRules, describeOrderFlow } from './support/orders.ts';

describeOrderFlow('sales-order');
describeOrderDocumentRules('sales-order');
