// @covers gateway/src/public-api/public-api.controller.ts
import { describeOrderDocumentRules, describeOrderFlow } from './support/orders.ts';

describeOrderFlow('purchase-order');
describeOrderDocumentRules('purchase-order');
