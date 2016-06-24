package com.test.thalitest;

import org.junit.runner.RunWith;
import org.junit.runners.Suite;

@RunWith(Suite.class)
@Suite.SuiteClasses({
        StreamCopyingThreadTest.class,
        LifeCycleMonitorTest.class,
        ConnectivityMonitorTest.class,
        ConnectionHelperTest.class,
        ConnectionModelTest.class
})

public class ThaliTestSuite {
}
