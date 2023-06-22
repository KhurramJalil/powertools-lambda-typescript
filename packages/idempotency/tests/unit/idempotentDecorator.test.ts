/**
 * Test Function Wrapper
 *
 * @group unit/idempotency/decorator
 */

import { BasePersistenceLayer, IdempotencyRecord } from '../../src/persistence';
import { idempotentFunction, idempotentLambdaHandler } from '../../src/';
import type { IdempotencyRecordOptions } from '../../src/types';
import { IdempotencyRecordStatus } from '../../src/types';
import {
  IdempotencyAlreadyInProgressError,
  IdempotencyInconsistentStateError,
  IdempotencyItemAlreadyExistsError,
  IdempotencyPersistenceLayerError,
} from '../../src/Exceptions';
import { IdempotencyConfig } from '../../src';
import { Context } from 'aws-lambda';
import { helloworldContext } from '@aws-lambda-powertools/commons/lib/samples/resources/contexts';

const mockSaveInProgress = jest
  .spyOn(BasePersistenceLayer.prototype, 'saveInProgress')
  .mockImplementation();
const mockSaveSuccess = jest
  .spyOn(BasePersistenceLayer.prototype, 'saveSuccess')
  .mockImplementation();
const mockGetRecord = jest
  .spyOn(BasePersistenceLayer.prototype, 'getRecord')
  .mockImplementation();

const dummyContext = helloworldContext;

const mockConfig: IdempotencyConfig = new IdempotencyConfig({});

class PersistenceLayerTestClass extends BasePersistenceLayer {
  protected _deleteRecord = jest.fn();
  protected _getRecord = jest.fn();
  protected _putRecord = jest.fn();
  protected _updateRecord = jest.fn();
}

const functionalityToDecorate = jest.fn();

class TestinClassWithLambdaHandler {
  @idempotentLambdaHandler({
    persistenceStore: new PersistenceLayerTestClass(),
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public testing(record: Record<string, unknown>, context: Context): string {
    functionalityToDecorate(record);

    return 'Hi';
  }
}

class TestingClassWithFunctionDecorator {
  public handler(record: Record<string, unknown>, context: Context): string {
    mockConfig.registerLambdaContext(context);

    return this.proccessRecord(record);
  }

  @idempotentFunction({
    persistenceStore: new PersistenceLayerTestClass(),
    dataKeywordArgument: 'testingKey',
    config: mockConfig,
  })
  public proccessRecord(record: Record<string, unknown>): string {
    functionalityToDecorate(record);

    return 'Processed Record';
  }
}

describe('Given a class with a function to decorate', (classWithLambdaHandler = new TestinClassWithLambdaHandler(), classWithFunctionDecorator = new TestingClassWithFunctionDecorator()) => {
  const keyValueToBeSaved = 'thisWillBeSaved';
  const inputRecord = {
    testingKey: keyValueToBeSaved,
    otherKey: 'thisWillNot',
  };
  beforeEach(() => jest.clearAllMocks());

  describe('When wrapping a function with no previous executions', () => {
    beforeEach(async () => {
      await classWithFunctionDecorator.handler(inputRecord, dummyContext);
    });

    test('Then it will save the record to INPROGRESS', () => {
      expect(mockSaveInProgress).toBeCalledWith(
        keyValueToBeSaved,
        dummyContext.getRemainingTimeInMillis()
      );
    });

    test('Then it will call the function that was decorated', () => {
      expect(functionalityToDecorate).toBeCalledWith(inputRecord);
    });

    test('Then it will save the record to COMPLETED with function return value', () => {
      expect(mockSaveSuccess).toBeCalledWith(
        keyValueToBeSaved,
        'Processed Record'
      );
    });
  });
  describe('When wrapping a function with no previous executions', () => {
    beforeEach(async () => {
      await classWithLambdaHandler.testing(inputRecord, dummyContext);
    });

    test('Then it will save the record to INPROGRESS', () => {
      expect(mockSaveInProgress).toBeCalledWith(
        inputRecord,
        dummyContext.getRemainingTimeInMillis()
      );
    });

    test('Then it will call the function that was decorated', () => {
      expect(functionalityToDecorate).toBeCalledWith(inputRecord);
    });

    test('Then it will save the record to COMPLETED with function return value', () => {
      expect(mockSaveSuccess).toBeCalledWith(inputRecord, 'Hi');
    });
  });

  describe('When decorating a function with previous execution that is INPROGRESS', () => {
    let resultingError: Error;
    beforeEach(async () => {
      mockSaveInProgress.mockRejectedValue(
        new IdempotencyItemAlreadyExistsError()
      );
      const idempotencyOptions: IdempotencyRecordOptions = {
        idempotencyKey: 'key',
        status: IdempotencyRecordStatus.INPROGRESS,
      };
      mockGetRecord.mockResolvedValue(
        new IdempotencyRecord(idempotencyOptions)
      );
      try {
        await classWithLambdaHandler.testing(inputRecord, dummyContext);
      } catch (e) {
        resultingError = e as Error;
      }
    });

    test('Then it will attempt to save the record to INPROGRESS', () => {
      expect(mockSaveInProgress).toBeCalledWith(
        inputRecord,
        dummyContext.getRemainingTimeInMillis()
      );
    });

    test('Then it will get the previous execution record', () => {
      expect(mockGetRecord).toBeCalledWith(inputRecord);
    });

    test('Then it will not call the function that was decorated', () => {
      expect(functionalityToDecorate).not.toBeCalled();
    });

    test('Then an IdempotencyAlreadyInProgressError is thrown', () => {
      expect(resultingError).toBeInstanceOf(IdempotencyAlreadyInProgressError);
    });
  });

  describe('When decorating a function with previous execution that is EXPIRED', () => {
    let resultingError: Error;
    beforeEach(async () => {
      mockSaveInProgress.mockRejectedValue(
        new IdempotencyItemAlreadyExistsError()
      );
      const idempotencyOptions: IdempotencyRecordOptions = {
        idempotencyKey: 'key',
        status: IdempotencyRecordStatus.EXPIRED,
      };
      mockGetRecord.mockResolvedValue(
        new IdempotencyRecord(idempotencyOptions)
      );
      try {
        await classWithLambdaHandler.testing(inputRecord, dummyContext);
      } catch (e) {
        resultingError = e as Error;
      }
    });

    test('Then it will attempt to save the record to INPROGRESS', () => {
      expect(mockSaveInProgress).toBeCalledWith(
        inputRecord,
        dummyContext.getRemainingTimeInMillis()
      );
    });

    test('Then it will get the previous execution record', () => {
      expect(mockGetRecord).toBeCalledWith(inputRecord);
    });

    test('Then it will not call the function that was decorated', () => {
      expect(functionalityToDecorate).not.toBeCalled();
    });

    test('Then an IdempotencyInconsistentStateError is thrown', () => {
      expect(resultingError).toBeInstanceOf(IdempotencyInconsistentStateError);
    });
  });

  describe('When wrapping a function with previous execution that is COMPLETED', () => {
    beforeEach(async () => {
      mockSaveInProgress.mockRejectedValue(
        new IdempotencyItemAlreadyExistsError()
      );
      const idempotencyOptions: IdempotencyRecordOptions = {
        idempotencyKey: 'key',
        status: IdempotencyRecordStatus.COMPLETED,
      };

      mockGetRecord.mockResolvedValue(
        new IdempotencyRecord(idempotencyOptions)
      );
      await classWithLambdaHandler.testing(inputRecord, dummyContext);
    });

    test('Then it will attempt to save the record to INPROGRESS', () => {
      expect(mockSaveInProgress).toBeCalledWith(
        inputRecord,
        dummyContext.getRemainingTimeInMillis()
      );
    });

    test('Then it will get the previous execution record', () => {
      expect(mockGetRecord).toBeCalledWith(inputRecord);
    });

    test('Then it will not call decorated functionality', () => {
      expect(functionalityToDecorate).not.toBeCalledWith(inputRecord);
    });
  });

  describe('When wrapping a function with issues saving the record', () => {
    class TestinClassWithLambdaHandlerWithConfig {
      @idempotentLambdaHandler({
        persistenceStore: new PersistenceLayerTestClass(),
        config: new IdempotencyConfig({ lambdaContext: dummyContext }),
      })
      public testing(record: Record<string, unknown>): string {
        functionalityToDecorate(record);

        return 'Hi';
      }
    }

    let resultingError: Error;
    beforeEach(async () => {
      mockSaveInProgress.mockRejectedValue(new Error('RandomError'));
      const classWithLambdaHandlerWithConfig =
        new TestinClassWithLambdaHandlerWithConfig();
      try {
        await classWithLambdaHandlerWithConfig.testing(inputRecord);
      } catch (e) {
        resultingError = e as Error;
      }
    });

    test('Then it will attempt to save the record to INPROGRESS', () => {
      expect(mockSaveInProgress).toBeCalledWith(
        inputRecord,
        dummyContext.getRemainingTimeInMillis()
      );
    });

    test('Then an IdempotencyPersistenceLayerError is thrown', () => {
      expect(resultingError).toBeInstanceOf(IdempotencyPersistenceLayerError);
    });
  });
});